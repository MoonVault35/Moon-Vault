import json
import logging
from django.conf import settings
from .db import get_db

logger = logging.getLogger(__name__)

# Try importing pywebpush safely
try:
    from pywebpush import webpush, WebPushException
    PYWEBPUSH_AVAILABLE = True
except ImportError:
    PYWEBPUSH_AVAILABLE = False
    logger.warning("pywebpush not installed. Web push notifications will be simulated.")


def send_web_push(user_id, title, body, url='/', image=None, tag='moonvault'):
    """
    Send Web Push notification to all active devices of a given user.
    Pops up in the user's phone notification bar (Android / iOS / Windows / Mac).
    """
    try:
        db = get_db()
        subscriptions = list(db.push_subscriptions.find({'user_id': str(user_id)}))
        if not subscriptions:
            return 0

        vapid_private_key = getattr(settings, 'VAPID_PRIVATE_KEY', None)
        vapid_claims = getattr(settings, 'VAPID_CLAIMS', {'sub': 'mailto:admin@moonvaultfc.com'})

        if not PYWEBPUSH_AVAILABLE or not vapid_private_key:
            return 0

        payload = {
            'title': title,
            'body': body,
            'url': url,
            'tag': tag,
            'icon': '/static/core/images/logo-192.png',
            'badge': '/static/core/images/badge-72.png',
        }
        if image:
            # Ensure full url or media path
            payload['image'] = image if image.startswith(('http://', 'https://', '/')) else f"/media/{image}"

        payload_json = json.dumps(payload)
        success_count = 0
        stale_ids = []

        for sub_doc in subscriptions:
            sub_info = sub_doc.get('subscription')
            if not sub_info:
                continue

            try:
                webpush(
                    subscription_info=sub_info,
                    data=payload_json,
                    vapid_private_key=vapid_private_key,
                    vapid_claims=vapid_claims,
                    timeout=5
                )
                success_count += 1
            except WebPushException as ex:
                # If subscription has expired or unsubscribed (404/410), mark for deletion
                if ex.response and ex.response.status_code in (404, 410):
                    stale_ids.append(sub_doc['_id'])
                else:
                    logger.debug(f"Push delivery notice for {user_id}: {ex}")
            except Exception as e:
                logger.debug(f"Push delivery error for {user_id}: {e}")

        # Clean up stale/unregistered tokens
        if stale_ids:
            db.push_subscriptions.delete_many({'_id': {'$in': stale_ids}})

        return success_count
    except Exception as e:
        logger.error(f"Error in send_web_push: {e}")
        return 0


def notify_all_players(title, body, url='/announcements/', image=None, tag='announcement'):
    """
    Send push notification to all players when an announcement is posted.
    """
    try:
        db = get_db()
        # Get all distinct user_ids that have subscriptions
        subscribed_user_ids = db.push_subscriptions.distinct('user_id')
        total_sent = 0
        for uid in subscribed_user_ids:
            total_sent += send_web_push(
                user_id=uid,
                title=title,
                body=body,
                url=url,
                image=image,
                tag=tag
            )
        return total_sent
    except Exception as e:
        logger.error(f"Error notifying players: {e}")
        return 0

