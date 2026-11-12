import os
import io
import base64
import mimetypes
import logging
from datetime import datetime
from django.conf import settings
from django.http import HttpResponse, Http404
from .db import get_db

logger = logging.getLogger(__name__)


def optimize_image_bytes(raw_bytes, max_dim=1280, quality=82):
    """
    Safely resize and compress an image with Pillow to minimize storage size
    while preserving crisp visual quality on mobile and desktop screens.
    """
    try:
        from PIL import Image, ImageOps
        with Image.open(io.BytesIO(raw_bytes)) as img:
            # Normalize EXIF orientation (prevents upside-down camera photos)
            img = ImageOps.exif_transpose(img)

            orig_format = (img.format or 'JPEG').upper()
            has_alpha = img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info)

            # Resize if dimensions exceed max_dim
            if img.width > max_dim or img.height > max_dim:
                img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)

            buf = io.BytesIO()
            if has_alpha and orig_format in ('PNG', 'WEBP'):
                img.save(buf, format='PNG', optimize=True)
                content_type = 'image/png'
            else:
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                img.save(buf, format='JPEG', quality=quality, optimize=True)
                content_type = 'image/jpeg'

            return buf.getvalue(), content_type
    except Exception as e:
        logger.debug(f"Pillow optimization bypassed: {e}")
        return raw_bytes, 'image/jpeg'


def save_media_file(rel_path, raw_bytes, content_type=None):
    """
    Persists an uploaded file to BOTH:
      1. Local disk at settings.MEDIA_ROOT / rel_path (fast local cache)
      2. MongoDB Atlas collection 'media_files' (permanent persistent storage)
    Returns (normalized_rel_path, data_url).
    """
    if not rel_path or not raw_bytes:
        return '', ''

    rel_path = rel_path.replace('\\', '/').lstrip('/')

    # 1. Optimize image bytes
    optimized_bytes, detected_ct = optimize_image_bytes(raw_bytes)
    final_content_type = content_type or detected_ct or 'image/jpeg'

    # 2. Write to local disk cache
    try:
        full_path = os.path.join(settings.MEDIA_ROOT, rel_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, 'wb') as f:
            f.write(optimized_bytes)
    except Exception as e:
        logger.warning(f"Could not write media file to disk cache: {e}")

    # 3. Persist to MongoDB Atlas permanently
    b64_str = base64.b64encode(optimized_bytes).decode('utf-8')
    data_url = f"data:{final_content_type};base64,{b64_str}"

    try:
        db = get_db()
        db.media_files.update_one(
            {'path': rel_path},
            {'$set': {
                'path': rel_path,
                'data': b64_str,
                'content_type': final_content_type,
                'size': len(optimized_bytes),
                'updated_at': datetime.utcnow()
            }},
            upsert=True
        )
    except Exception as e:
        logger.error(f"Could not persist media file to MongoDB: {e}")

    return rel_path, data_url


def get_media_file(rel_path):
    """
    Retrieves media file bytes and content type.
    Checks local disk first. If missing (e.g. Render woke up from sleep),
    it fetches from MongoDB Atlas and re-creates the disk cache.
    Returns (bytes, content_type) or (None, None).
    """
    if not rel_path:
        return None, None

    rel_path = rel_path.replace('\\', '/').lstrip('/')
    full_path = os.path.join(settings.MEDIA_ROOT, rel_path)

    # 1. Check local disk cache first
    if os.path.exists(full_path) and os.path.isfile(full_path) and os.path.getsize(full_path) > 0:
        try:
            with open(full_path, 'rb') as f:
                data = f.read()
            guessed_type, _ = mimetypes.guess_type(full_path)
            ct = guessed_type or 'image/jpeg'

            # Auto-backup to MongoDB if not yet present
            try:
                db = get_db()
                if not db.media_files.find_one({'path': rel_path}, {'_id': 1}):
                    b64_str = base64.b64encode(data).decode('utf-8')
                    db.media_files.update_one(
                        {'path': rel_path},
                        {'$set': {
                            'path': rel_path,
                            'data': b64_str,
                            'content_type': ct,
                            'size': len(data),
                            'updated_at': datetime.utcnow()
                        }},
                        upsert=True
                    )
            except Exception:
                pass

            return data, ct
        except Exception:
            pass

    # 2. Missing from disk (e.g. Render restarted/slept) -> Fetch from MongoDB Atlas
    try:
        db = get_db()
        # Direct lookup in media_files
        doc = db.media_files.find_one({'path': rel_path})

        # Fuzzy lookup by filename if path differed
        if not doc:
            filename = os.path.basename(rel_path)
            doc = db.media_files.find_one({'path': {'$regex': f"{filename}$"}})

        # Fallback to chat messages data_url
        if not doc and 'chat_images' in rel_path:
            filename = os.path.basename(rel_path)
            msg = db.messages.find_one({'image': {'$regex': f"{filename}$"}})
            if msg and msg.get('image_data') and msg['image_data'].startswith('data:'):
                try:
                    header, b64_part = msg['image_data'].split(',', 1)
                    ct = header.split(';')[0].replace('data:', '')
                    doc = {'data': b64_part, 'content_type': ct}
                except Exception:
                    pass

        if doc and doc.get('data'):
            b64_str = doc['data']
            file_bytes = base64.b64decode(b64_str)
            ct = doc.get('content_type') or 'image/jpeg'

            # Re-write to local disk cache so subsequent requests are fast
            try:
                os.makedirs(os.path.dirname(full_path), exist_ok=True)
                with open(full_path, 'wb') as f:
                    f.write(file_bytes)
            except Exception as e:
                logger.warning(f"Failed to re-cache media file to disk: {e}")

            return file_bytes, ct
    except Exception as e:
        logger.error(f"Error fetching media file from MongoDB: {e}")

    return None, None


def delete_media_file(rel_path):
    """
    Deletes media file from both local disk cache and MongoDB Atlas.
    """
    if not rel_path:
        return

    rel_path = rel_path.replace('\\', '/').lstrip('/')
    full_path = os.path.join(settings.MEDIA_ROOT, rel_path)

    try:
        if os.path.exists(full_path):
            os.remove(full_path)
    except Exception:
        pass

    try:
        db = get_db()
        filename = os.path.basename(rel_path)
        db.media_files.delete_many({
            '$or': [
                {'path': rel_path},
                {'path': {'$regex': f"{filename}$"}}
            ]
        })
    except Exception:
        pass


def serve_media(request, path):
    """
    Django view that replaces static.serve for /media/<path>.
    Guarantees that files survive Render's sleep/restart cycles by pulling
    from MongoDB Atlas when the local disk is wiped.
    """
    data, content_type = get_media_file(path)
    if data is None:
        raise Http404(f"Media file '{path}' not found")

    response = HttpResponse(data, content_type=content_type)
    response['Cache-Control'] = 'public, max-age=86400, stale-while-revalidate=604800'
    response['Content-Length'] = len(data)
    return response
