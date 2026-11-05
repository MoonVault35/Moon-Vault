import os
import json
from datetime import datetime
from bson import ObjectId
from django.shortcuts import render, redirect
from django.http import JsonResponse, HttpResponse
from django.contrib import messages
from django.contrib.auth.hashers import make_password, check_password
from django.views.decorators.http import require_POST
from django.conf import settings
from pymongo.errors import PyMongoError
from .db import get_db, generate_player_id
from .decorators import login_required_custom, admin_required
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync


# ─── Public Views ──────────────────────────────────────────

def normalize_doc(doc):
    if doc and isinstance(doc, dict):
        if '_id' in doc:
            doc['id'] = str(doc['_id'])
            doc['_id'] = str(doc['_id'])
    return doc


def landing(request):
    if 'user_id' in request.session:
        return redirect('home')
    return render(request, 'core/landing.html')


def login_view(request):
    if 'user_id' in request.session:
        return redirect('home')

    if request.method == 'POST':
        username = request.POST.get('username', '').strip()
        password = request.POST.get('password', '')

        if not username or not password:
            messages.error(request, 'Please enter both username and password.')
            return render(request, 'core/login.html')

        try:
            db = get_db()

            # Check admin
            admin = db.admin.find_one({'username': username})
            if admin and check_password(password, admin['password_hash']):
                request.session['user_id'] = str(admin['_id'])
                request.session['role'] = 'admin'
                request.session['username'] = username
                request.session['full_name'] = 'Administrator'
                return redirect('home')

            # Check players by username, player_id (e.g. PLR-0001), or full_name
            player = db.players.find_one({
                '$or': [
                    {'username': {'$regex': f'^{username}$', '$options': 'i'}},
                    {'player_id': {'$regex': f'^{username}$', '$options': 'i'}},
                    {'full_name': {'$regex': f'^{username}$', '$options': 'i'}},
                ]
            })
            if player and check_password(password, player['password_hash']):
                if player.get('status') != 'active':
                    messages.error(request, 'Your account is inactive. Contact the admin.')
                    return render(request, 'core/login.html')
                request.session['user_id'] = str(player['_id'])
                request.session['role'] = 'player'
                request.session['username'] = player.get('username', username)
                request.session['full_name'] = player.get('full_name', username)
                return redirect('home')

            messages.error(request, 'Invalid username or password.')
        except PyMongoError as exc:
            messages.error(request, f'Database connection error: {exc}. Please verify MONGODB_URI in .env')

    return render(request, 'core/login.html')


def logout_view(request):
    request.session.flush()
    messages.success(request, 'You have been logged out.')
    return redirect('landing')


# ─── Home Dashboard ─────────────────────────────────────────

@login_required_custom
def home(request):
    db = get_db()
    role = request.session.get('role')

    if role == 'admin':
        total_players = db.players.count_documents({})
        active_players = db.players.count_documents({'status': 'active'})
        inactive_players = db.players.count_documents({'status': 'inactive'})
        recent_players = list(db.players.find().sort('created_at', -1).limit(5))
        for p in recent_players:
            normalize_doc(p)

        # Recent messages
        recent_msgs = list(db.messages.find().sort('timestamp', -1).limit(10))
        for msg in recent_msgs:
            normalize_doc(msg)
            # Get sender/receiver names
            sender = db.players.find_one({'_id': ObjectId(msg['sender_id'])}) if ObjectId.is_valid(msg['sender_id']) else None
            if not sender:
                sender = db.admin.find_one({'_id': ObjectId(msg['sender_id'])}) if ObjectId.is_valid(msg['sender_id']) else None
            msg['sender_name'] = sender.get('full_name', sender.get('username', 'Unknown')) if sender else 'Admin'

        latest_announcement = db.announcements.find_one(sort=[('created_at', -1)])
        if latest_announcement:
            normalize_doc(latest_announcement)

        return render(request, 'core/home_admin.html', {
            'total_players': total_players,
            'active_players': active_players,
            'inactive_players': inactive_players,
            'recent_players': recent_players,
            'recent_messages': recent_msgs,
            'latest_announcement': latest_announcement,
        })

    else:
        user_id = request.session.get('user_id')
        player = db.players.find_one({'_id': ObjectId(user_id)})
        if not player:
            request.session.flush()
            return redirect('login')
        normalize_doc(player)

        # Recent messages
        recent_msgs = list(db.messages.find({
            '$or': [
                {'sender_id': user_id},
                {'receiver_id': user_id}
            ]
        }).sort('timestamp', -1).limit(5))
        for msg in recent_msgs:
            normalize_doc(msg)

        unread_count = db.messages.count_documents({
            'receiver_id': user_id,
            'is_read': False
        })

        latest_announcement = db.announcements.find_one(sort=[('created_at', -1)])
        if latest_announcement:
            normalize_doc(latest_announcement)

        return render(request, 'core/home_player.html', {
            'player': player,
            'recent_messages': recent_msgs,
            'unread_count': unread_count,
            'latest_announcement': latest_announcement,
        })


# ─── Player Management ──────────────────────────────────────

@admin_required
def players_list(request):
    db = get_db()
    search = request.GET.get('q', '').strip()

    if search:
        query = {
            '$or': [
                {'full_name': {'$regex': search, '$options': 'i'}},
                {'username': {'$regex': search, '$options': 'i'}},
                {'position': {'$regex': search, '$options': 'i'}},
                {'jersey_number': {'$regex': search, '$options': 'i'}},
                {'player_id': {'$regex': search, '$options': 'i'}},
            ]
        }
    else:
        query = {}

    players = list(db.players.find(query).sort('created_at', -1))
    for p in players:
        normalize_doc(p)
        # Resolve tags
        tag_ids = p.get('tags', [])
        p['tag_list'] = []
        for tid in tag_ids:
            try:
                tag = db.tags.find_one({'_id': ObjectId(tid)})
                if tag:
                    p['tag_list'].append(tag.get('tag_name', ''))
            except Exception:
                pass

    return render(request, 'core/players_list.html', {
        'players': players,
        'search_query': search,
    })


@admin_required
def player_add(request):
    db = get_db()

    if request.method == 'POST':
        full_name = request.POST.get('full_name', '').strip()
        password = request.POST.get('password', '')

        # Validation
        if not full_name or not password:
            messages.error(request, 'Full name and password are required.')
            return render(request, 'core/player_form.html', {
                'is_edit': False, 'form_data': request.POST
            })

        if len(password) < 6:
            messages.error(request, 'Password must be at least 6 characters.')
            return render(request, 'core/player_form.html', {
                'is_edit': False, 'form_data': request.POST
            })

        player_id = generate_player_id()
        username = player_id.lower()

        # Handle profile picture
        profile_picture = ''
        if 'profile_picture' in request.FILES:
            pic = request.FILES['profile_picture']
            upload_dir = os.path.join(settings.MEDIA_ROOT, 'profile_pics')
            os.makedirs(upload_dir, exist_ok=True)
            ext = os.path.splitext(pic.name)[1]
            filename = f"{player_id}{ext}"
            filepath = os.path.join(upload_dir, filename)
            with open(filepath, 'wb+') as f:
                for chunk in pic.chunks():
                    f.write(chunk)
            profile_picture = f"profile_pics/{filename}"

        player_doc = {
            'player_id': player_id,
            'full_name': full_name,
            'username': username,
            'password_hash': make_password(password),
            'profile_picture': profile_picture,
            'status': 'active',
            'created_at': datetime.utcnow(),
        }
        db.players.insert_one(player_doc)
        messages.success(request, f'Player "{full_name}" created successfully with ID: {player_id}')
        return redirect('players_list')

    return render(request, 'core/player_form.html', {
        'is_edit': False,
    })


@admin_required
def player_edit(request, player_id):
    db = get_db()
    player = db.players.find_one({'_id': ObjectId(player_id)})
    if not player:
        messages.error(request, 'Player not found.')
        return redirect('players_list')

    if request.method == 'POST':
        full_name = request.POST.get('full_name', '').strip()
        new_password = request.POST.get('password', '').strip()

        if not full_name:
            messages.error(request, 'Full name is required.')
            normalize_doc(player)
            return render(request, 'core/player_form.html', {
                'is_edit': True, 'player': player,
            })

        update_data = {
            'full_name': full_name,
        }

        if new_password:
            if len(new_password) < 6:
                messages.error(request, 'Password must be at least 6 characters.')
                normalize_doc(player)
                return render(request, 'core/player_form.html', {
                    'is_edit': True, 'player': player,
                })
            update_data['password_hash'] = make_password(new_password)

        # Handle profile picture
        if 'profile_picture' in request.FILES:
            pic = request.FILES['profile_picture']
            upload_dir = os.path.join(settings.MEDIA_ROOT, 'profile_pics')
            os.makedirs(upload_dir, exist_ok=True)
            ext = os.path.splitext(pic.name)[1]
            filename = f"{player.get('player_id', player_id)}{ext}"
            filepath = os.path.join(upload_dir, filename)
            with open(filepath, 'wb+') as f:
                for chunk in pic.chunks():
                    f.write(chunk)
            update_data['profile_picture'] = f"profile_pics/{filename}"

        db.players.update_one({'_id': ObjectId(player_id)}, {'$set': update_data})
        messages.success(request, f'Player "{full_name}" updated successfully!')
        return redirect('players_list')

    normalize_doc(player)
    return render(request, 'core/player_form.html', {
        'is_edit': True,
        'player': player,
    })


@admin_required
@require_POST
def player_delete(request, player_id):
    db = get_db()
    player = db.players.find_one({'_id': ObjectId(player_id)})
    if player:
        # Delete player's messages
        db.messages.delete_many({
            '$or': [
                {'sender_id': player_id},
                {'receiver_id': player_id}
            ]
        })
        # Delete profile picture
        if player.get('profile_picture'):
            pic_path = os.path.join(settings.MEDIA_ROOT, player['profile_picture'])
            if os.path.exists(pic_path):
                os.remove(pic_path)
        db.players.delete_one({'_id': ObjectId(player_id)})
        messages.success(request, f'Player "{player.get("full_name")}" deleted.')
    else:
        messages.error(request, 'Player not found.')
    return redirect('players_list')


@admin_required
@require_POST
def player_toggle_status(request, player_id):
    db = get_db()
    player = db.players.find_one({'_id': ObjectId(player_id)})
    if player:
        new_status = 'inactive' if player.get('status') == 'active' else 'active'
        db.players.update_one(
            {'_id': ObjectId(player_id)},
            {'$set': {'status': new_status}}
        )
        messages.success(request, f'Player status changed to {new_status}.')
    return redirect('players_list')


# ─── Chat ────────────────────────────────────────────────────

@login_required_custom
def chat(request):
    db = get_db()
    role = request.session.get('role')
    user_id = request.session.get('user_id')

    if role == 'admin':
        # Get all players for sidebar
        players = list(db.players.find({}, {
            'full_name': 1, 'username': 1, 'profile_picture': 1, 'status': 1, 'player_id': 1
        }).sort('full_name', 1))
        for p in players:
            normalize_doc(p)
            # Unread count for each player
            p['unread'] = db.messages.count_documents({
                'sender_id': str(p['id']),
                'receiver_id': user_id,
                'is_read': False
            })
            # Last message
            last_msg = db.messages.find_one(
                {'$or': [
                    {'sender_id': str(p['id']), 'receiver_id': user_id},
                    {'sender_id': user_id, 'receiver_id': str(p['id'])}
                ]},
                sort=[('timestamp', -1)]
            )
            if last_msg:
                if last_msg.get('message'):
                    p['last_message'] = last_msg['message'][:35]
                elif last_msg.get('image'):
                    p['last_message'] = '📷 Photo'
                else:
                    p['last_message'] = ''
                p['last_time'] = last_msg.get('timestamp', '')
            else:
                p['last_message'] = ''
                p['last_time'] = ''

        # Sort by last message time (most recent first)
        players.sort(key=lambda x: x.get('last_time', ''), reverse=True)

        active_player_id = request.GET.get('player')
        active_player = None
        chat_messages = []

        if active_player_id:
            active_player = db.players.find_one({'_id': ObjectId(active_player_id)})
            if active_player:
                normalize_doc(active_player)
                chat_messages = list(db.messages.find({
                    '$or': [
                        {'sender_id': user_id, 'receiver_id': active_player_id},
                        {'sender_id': active_player_id, 'receiver_id': user_id}
                    ]
                }).sort('timestamp', 1))
                for msg in chat_messages:
                    normalize_doc(msg)
                # Mark as read
                db.messages.update_many(
                    {'sender_id': active_player_id, 'receiver_id': user_id, 'is_read': False},
                    {'$set': {'is_read': True}}
                )

        return render(request, 'core/chat.html', {
            'players': players,
            'active_player': active_player,
            'chat_messages': chat_messages,
        })

    else:
        # Player view - chat with admin only
        admin = db.admin.find_one()
        admin_id = str(admin['_id']) if admin else None

        chat_messages = []
        if admin_id:
            chat_messages = list(db.messages.find({
                '$or': [
                    {'sender_id': user_id, 'receiver_id': admin_id},
                    {'sender_id': admin_id, 'receiver_id': user_id}
                ]
            }).sort('timestamp', 1))
            for msg in chat_messages:
                normalize_doc(msg)
            # Mark admin messages as read
            db.messages.update_many(
                {'sender_id': admin_id, 'receiver_id': user_id, 'is_read': False},
                {'$set': {'is_read': True}}
            )

        return render(request, 'core/chat.html', {
            'admin_id': admin_id,
            'chat_messages': chat_messages,
        })


@login_required_custom
def chat_messages(request, player_id):
    """API: Get messages between current user and player_id."""
    db = get_db()
    user_id = request.session.get('user_id')
    role = request.session.get('role')

    # Determine the other party
    if role == 'admin':
        other_id = player_id
    else:
        admin = db.admin.find_one()
        other_id = str(admin['_id']) if admin else None
        if other_id != player_id:
            return JsonResponse({'error': 'Unauthorized'}, status=403)

    msgs = list(db.messages.find({
        '$or': [
            {'sender_id': user_id, 'receiver_id': other_id},
            {'sender_id': other_id, 'receiver_id': user_id}
        ]
    }).sort('timestamp', 1))

    result = []
    for msg in msgs:
        result.append({
            'id': str(msg['_id']),
            'sender_id': msg['sender_id'],
            'receiver_id': msg['receiver_id'],
            'message': msg.get('message', ''),
            'image': msg.get('image', ''),
            'timestamp': msg['timestamp'].strftime('%b %d, %I:%M %p') if isinstance(msg['timestamp'], datetime) else str(msg['timestamp']),
            'is_read': msg.get('is_read', False),
            'is_mine': msg['sender_id'] == user_id,
        })

    return JsonResponse({'messages': result})


@login_required_custom
@require_POST
def chat_send(request):
    """API: Send a message with optional image attachment."""
    db = get_db()
    user_id = request.session.get('user_id')
    role = request.session.get('role')

    if request.content_type == 'application/json':
        data = json.loads(request.body)
        message_text = data.get('message', '').strip()
        receiver_id = data.get('receiver_id', '').strip()
    else:
        message_text = request.POST.get('message', '').strip()
        receiver_id = request.POST.get('receiver_id', '').strip()

    has_image = 'image' in request.FILES
    if (not message_text and not has_image) or not receiver_id:
        return JsonResponse({'error': 'Message text or image attachment is required.'}, status=400)

    # Validate receiver
    if role == 'player':
        admin = db.admin.find_one()
        if not admin or str(admin['_id']) != receiver_id:
            return JsonResponse({'error': 'Players can only message the admin.'}, status=403)
    else:
        player = db.players.find_one({'_id': ObjectId(receiver_id)})
        if not player:
            return JsonResponse({'error': 'Player not found.'}, status=404)

    # Process optional image
    image_path = ''
    if has_image:
        pic = request.FILES['image']
        upload_dir = os.path.join(settings.MEDIA_ROOT, 'chat_images')
        os.makedirs(upload_dir, exist_ok=True)
        ext = os.path.splitext(pic.name)[1].lower() or '.jpg'
        timestamp_str = datetime.utcnow().strftime('%Y%m%d%H%M%S%f')
        filename = f"chat_{timestamp_str}{ext}"
        filepath = os.path.join(upload_dir, filename)
        with open(filepath, 'wb+') as dest:
            for chunk in pic.chunks():
                dest.write(chunk)
        image_path = f"chat_images/{filename}"

    now = datetime.utcnow()
    msg_doc = {
        'sender_id': user_id,
        'receiver_id': receiver_id,
        'message': message_text,
        'image': image_path,
        'timestamp': now,
        'is_read': False,
    }
    result = db.messages.insert_one(msg_doc)
    msg_id = str(result.inserted_id)
    formatted_time = now.strftime('%b %d, %I:%M %p')

    # Real-time WebSocket broadcast via Channels
    try:
        channel_layer = get_channel_layer()
        if channel_layer:
            # Deliver to receiver's group
            async_to_sync(channel_layer.group_send)(
                f'chat_{receiver_id}',
                {
                    'type': 'chat_message',
                    'message': message_text,
                    'image': image_path,
                    'sender_id': user_id,
                    'receiver_id': receiver_id,
                    'timestamp': formatted_time,
                    'msg_id': msg_id,
                }
            )
            # Deliver to sender's other tabs
            async_to_sync(channel_layer.group_send)(
                f'chat_{user_id}',
                {
                    'type': 'chat_message_sent',
                    'message': message_text,
                    'image': image_path,
                    'sender_id': user_id,
                    'receiver_id': receiver_id,
                    'timestamp': formatted_time,
                    'msg_id': msg_id,
                }
            )
    except Exception as e:
        pass

    # Send Web Push notification to receiver's phone / desktop
    try:
        from .notifications import send_web_push
        sender_display_name = request.session.get('full_name') or request.session.get('username') or 'Club Member'
        chat_target_url = '/chat/' if role == 'player' else f"/chat/?player={user_id}"
        push_body = message_text if message_text else "📷 Sent a photo attachment"
        send_web_push(
            user_id=receiver_id,
            title=f"💬 {sender_display_name}",
            body=push_body,
            url=chat_target_url,
            image=image_path if image_path else None,
            tag=f"chat-{user_id}"
        )
    except Exception as e:
        pass

    return JsonResponse({
        'success': True,
        'message': {
            'id': msg_id,
            'sender_id': user_id,
            'receiver_id': receiver_id,
            'message': message_text,
            'image': image_path,
            'timestamp': formatted_time,
            'is_read': False,
            'is_mine': True,
        }
    })


@login_required_custom
@require_POST
def chat_mark_read(request, player_id):
    """Mark messages from player_id as read."""
    db = get_db()
    user_id = request.session.get('user_id')
    db.messages.update_many(
        {'sender_id': player_id, 'receiver_id': user_id, 'is_read': False},
        {'$set': {'is_read': True}}
    )
    return JsonResponse({'success': True})


@login_required_custom
def chat_unread_counts(request):
    """API: Get unread message counts."""
    db = get_db()
    user_id = request.session.get('user_id')
    role = request.session.get('role')

    if role == 'admin':
        players = list(db.players.find({}, {'_id': 1}))
        counts = {}
        for p in players:
            pid = str(p['_id'])
            count = db.messages.count_documents({
                'sender_id': pid,
                'receiver_id': user_id,
                'is_read': False
            })
            if count > 0:
                counts[pid] = count
        total = sum(counts.values())
        return JsonResponse({'counts': counts, 'total': total})
    else:
        total = db.messages.count_documents({
            'receiver_id': user_id,
            'is_read': False
        })
        return JsonResponse({'counts': {}, 'total': total})


# ─── Support ─────────────────────────────────────────────────

@login_required_custom
def support(request):
    db = get_db()
    support_info = db.support_contacts.find_one()
    if support_info:
        normalize_doc(support_info)
    return render(request, 'core/support.html', {'support': support_info})


@admin_required
def support_edit(request):
    db = get_db()
    support_info = db.support_contacts.find_one()

    if request.method == 'POST':
        update_data = {
            'facebook_page_url': request.POST.get('facebook_page_url', '').strip(),
            'messenger_url': request.POST.get('messenger_url', '').strip(),
            'contact_number': request.POST.get('contact_number', '').strip(),
            'alternative_number': request.POST.get('alternative_number', '').strip(),
            'support_message': request.POST.get('support_message', '').strip(),
        }

        if support_info:
            db.support_contacts.update_one({'_id': support_info['_id']}, {'$set': update_data})
        else:
            db.support_contacts.insert_one(update_data)

        messages.success(request, 'Support information updated successfully!')
        return redirect('support')

    if support_info:
        normalize_doc(support_info)
    return render(request, 'core/support_edit.html', {'support': support_info})


# ─── Payment Methods (previously Tags) ──────────────────────

@login_required_custom
def payment_methods(request):
    db = get_db()
    methods = list(db.payment_methods.find().sort('created_at', -1))
    for m in methods:
        normalize_doc(m)

    return render(request, 'core/tags.html', {
        'payment_methods': methods,
    })

tags = payment_methods  # Alias for backward compatibility


@admin_required
def payment_method_add(request):
    db = get_db()
    if request.method == 'POST':
        method_name = request.POST.get('method_name', '').strip()
        account_name = request.POST.get('account_name', '').strip()
        account_number = request.POST.get('account_number', '').strip()
        instructions = request.POST.get('instructions', '').strip()

        if not method_name:
            messages.error(request, 'Payment method name is required.')
            return redirect('tags')

        qr_image = ''
        if 'qr_image' in request.FILES:
            pic = request.FILES['qr_image']
            upload_dir = os.path.join(settings.MEDIA_ROOT, 'qr_codes')
            os.makedirs(upload_dir, exist_ok=True)
            ext = os.path.splitext(pic.name)[1]
            safe_name = "".join(c for c in method_name if c.isalnum() or c in ('-', '_')).lower()
            timestamp_str = datetime.utcnow().strftime('%Y%m%d%H%M%S')
            filename = f"{safe_name}_{timestamp_str}{ext}"
            filepath = os.path.join(upload_dir, filename)
            with open(filepath, 'wb+') as f:
                for chunk in pic.chunks():
                    f.write(chunk)
            qr_image = f"qr_codes/{filename}"

        db.payment_methods.insert_one({
            'method_name': method_name,
            'account_name': account_name,
            'account_number': account_number,
            'instructions': instructions,
            'qr_image': qr_image,
            'created_at': datetime.utcnow(),
        })
        messages.success(request, f'Payment method "{method_name}" added successfully!')
    return redirect('tags')

tag_add = payment_method_add


@admin_required
def payment_method_edit(request, method_id):
    db = get_db()
    method = db.payment_methods.find_one({'_id': ObjectId(method_id)})
    if not method:
        messages.error(request, 'Payment method not found.')
        return redirect('tags')

    if request.method == 'POST':
        method_name = request.POST.get('method_name', '').strip()
        account_name = request.POST.get('account_name', '').strip()
        account_number = request.POST.get('account_number', '').strip()
        instructions = request.POST.get('instructions', '').strip()

        if not method_name:
            messages.error(request, 'Method name is required.')
            return redirect('tags')

        update_data = {
            'method_name': method_name,
            'account_name': account_name,
            'account_number': account_number,
            'instructions': instructions,
        }

        if 'qr_image' in request.FILES:
            pic = request.FILES['qr_image']
            upload_dir = os.path.join(settings.MEDIA_ROOT, 'qr_codes')
            os.makedirs(upload_dir, exist_ok=True)
            ext = os.path.splitext(pic.name)[1]
            safe_name = "".join(c for c in method_name if c.isalnum() or c in ('-', '_')).lower()
            timestamp_str = datetime.utcnow().strftime('%Y%m%d%H%M%S')
            filename = f"{safe_name}_{timestamp_str}{ext}"
            filepath = os.path.join(upload_dir, filename)
            with open(filepath, 'wb+') as f:
                for chunk in pic.chunks():
                    f.write(chunk)
            update_data['qr_image'] = f"qr_codes/{filename}"

        db.payment_methods.update_one({'_id': ObjectId(method_id)}, {'$set': update_data})
        messages.success(request, f'Payment method "{method_name}" updated successfully!')
    return redirect('tags')

tag_edit = payment_method_edit


@admin_required
@require_POST
def payment_method_delete(request, method_id):
    db = get_db()
    method = db.payment_methods.find_one({'_id': ObjectId(method_id)})
    if method:
        if method.get('qr_image'):
            pic_path = os.path.join(settings.MEDIA_ROOT, method['qr_image'])
            if os.path.exists(pic_path):
                try:
                    os.remove(pic_path)
                except Exception:
                    pass
        db.payment_methods.delete_one({'_id': ObjectId(method_id)})
        messages.success(request, f'Payment method "{method.get("method_name")}" deleted.')
    else:
        messages.error(request, 'Payment method not found.')
    return redirect('tags')

tag_delete = payment_method_delete


# ─── Announcements ─────────────────────────────────────────

@login_required_custom
def announcements_list(request):
    db = get_db()
    now = datetime.utcnow()
    start_of_day = datetime(now.year, now.month, now.day, 0, 0, 0)
    end_of_day = datetime(now.year, now.month, now.day, 23, 59, 59, 999999)

    today_count = db.announcements.count_documents({
        'created_at': {'$gte': start_of_day, '$lte': end_of_day}
    })
    max_daily = 4
    can_post_today = today_count < max_daily
    remaining_today = max(0, max_daily - today_count)
    progress_percent = min(100, int((today_count / max_daily) * 100))

    announcements_cursor = db.announcements.find().sort('created_at', -1)
    announcements = []
    for a in announcements_cursor:
        normalize_doc(a)
        created = a.get('created_at')
        if isinstance(created, datetime):
            a['is_today'] = (created >= start_of_day and created <= end_of_day)
        else:
            a['is_today'] = False
        announcements.append(a)

    return render(request, 'core/announcements.html', {
        'announcements': announcements,
        'today_count': today_count,
        'remaining_today': remaining_today,
        'can_post_today': can_post_today,
        'max_daily': max_daily,
        'progress_percent': progress_percent,
    })


@admin_required
@require_POST
def announcement_add(request):
    db = get_db()
    now = datetime.utcnow()
    start_of_day = datetime(now.year, now.month, now.day, 0, 0, 0)
    end_of_day = datetime(now.year, now.month, now.day, 23, 59, 59, 999999)

    today_count = db.announcements.count_documents({
        'created_at': {'$gte': start_of_day, '$lte': end_of_day}
    })

    if today_count >= 4:
        messages.error(request, 'Daily limit reached! You can only post up to 4 announcements per day.')
        return redirect('announcements')

    title = request.POST.get('title', '').strip()
    content = request.POST.get('content', '').strip()
    category = request.POST.get('category', 'General').strip()

    if not title or not content:
        messages.error(request, 'Title and message are required.')
        return redirect('announcements')

    admin_name = request.session.get('full_name') or request.session.get('username') or 'Admin'

    # Handle optional image attachment
    image_path = ''
    if 'image' in request.FILES:
        pic = request.FILES['image']
        upload_dir = os.path.join(settings.MEDIA_ROOT, 'announcements')
        os.makedirs(upload_dir, exist_ok=True)
        ext = os.path.splitext(pic.name)[1].lower()
        safe_title = "".join(c for c in title[:15] if c.isalnum() or c in ('-', '_')).lower() or 'ann'
        timestamp_str = datetime.utcnow().strftime('%Y%m%d%H%M%S')
        filename = f"{safe_title}_{timestamp_str}{ext}"
        filepath = os.path.join(upload_dir, filename)
        with open(filepath, 'wb+') as f:
            for chunk in pic.chunks():
                f.write(chunk)
        image_path = f"announcements/{filename}"

    db.announcements.insert_one({
        'title': title,
        'content': content,
        'category': category,
        'author_name': admin_name,
        'image': image_path,
        'created_at': now,
        'updated_at': now,
    })

    # Trigger Web Push notification to all players' devices
    try:
        from .notifications import notify_all_players
        notify_all_players(
            title=f"📢 {title}",
            body=content[:120] + ('...' if len(content) > 120 else ''),
            url='/announcements/',
            image=image_path if image_path else None,
            tag='announcement'
        )
    except Exception as e:
        pass

    messages.success(request, f'Announcement "{title}" posted successfully! ({today_count + 1}/4 posted today)')
    return redirect('announcements')


@admin_required
@require_POST
def announcement_edit(request, announcement_id):
    db = get_db()
    title = request.POST.get('title', '').strip()
    content = request.POST.get('content', '').strip()
    category = request.POST.get('category', 'General').strip()

    if not title or not content:
        messages.error(request, 'Title and message cannot be empty.')
        return redirect('announcements')

    try:
        update_data = {
            'title': title,
            'content': content,
            'category': category,
            'updated_at': datetime.utcnow(),
        }

        # Check for new image
        if 'image' in request.FILES:
            pic = request.FILES['image']
            upload_dir = os.path.join(settings.MEDIA_ROOT, 'announcements')
            os.makedirs(upload_dir, exist_ok=True)
            ext = os.path.splitext(pic.name)[1].lower()
            safe_title = "".join(c for c in title[:15] if c.isalnum() or c in ('-', '_')).lower() or 'ann'
            timestamp_str = datetime.utcnow().strftime('%Y%m%d%H%M%S')
            filename = f"{safe_title}_{timestamp_str}{ext}"
            filepath = os.path.join(upload_dir, filename)
            with open(filepath, 'wb+') as f:
                for chunk in pic.chunks():
                    f.write(chunk)
            update_data['image'] = f"announcements/{filename}"

            # Delete old image if existed
            existing = db.announcements.find_one({'_id': ObjectId(announcement_id)})
            if existing and existing.get('image'):
                old_path = os.path.join(settings.MEDIA_ROOT, existing['image'])
                if os.path.exists(old_path):
                    try:
                        os.remove(old_path)
                    except Exception:
                        pass

        # Optional: remove image if requested
        if request.POST.get('remove_image') == '1':
            existing = db.announcements.find_one({'_id': ObjectId(announcement_id)})
            if existing and existing.get('image'):
                old_path = os.path.join(settings.MEDIA_ROOT, existing['image'])
                if os.path.exists(old_path):
                    try:
                        os.remove(old_path)
                    except Exception:
                        pass
            update_data['image'] = ''

        result = db.announcements.update_one(
            {'_id': ObjectId(announcement_id)},
            {'$set': update_data}
        )
        if result.matched_count:
            messages.success(request, 'Announcement updated successfully.')
        else:
            messages.error(request, 'Announcement not found.')
    except Exception as e:
        messages.error(request, f'Failed to update announcement: {e}')

    return redirect('announcements')


@admin_required
@require_POST
def announcement_delete(request, announcement_id):
    db = get_db()
    try:
        # Clean up image from disk
        ann = db.announcements.find_one({'_id': ObjectId(announcement_id)})
        if ann and ann.get('image'):
            img_path = os.path.join(settings.MEDIA_ROOT, ann['image'])
            if os.path.exists(img_path):
                try:
                    os.remove(img_path)
                except Exception:
                    pass

        result = db.announcements.delete_one({'_id': ObjectId(announcement_id)})
        if result.deleted_count:
            messages.success(request, 'Announcement deleted successfully.')
        else:
            messages.error(request, 'Announcement not found.')
    except Exception as e:
        messages.error(request, f'Failed to delete announcement: {e}')

    return redirect('announcements')


# ─── Change Password (Disabled) ────────────────────────────

@login_required_custom
def change_password(request):
    return redirect('home')


# ─── Web Push & Service Worker Views ───────────────────────

def service_worker(request):
    """Serve sw.js from root with root scope permission."""
    sw_path = os.path.join(settings.BASE_DIR, 'core', 'static', 'sw.js')
    try:
        with open(sw_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception:
        content = "/* sw.js */"
    response = HttpResponse(content, content_type='application/javascript')
    response['Service-Worker-Allowed'] = '/'
    response['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return response


@login_required_custom
@require_POST
def save_push_subscription(request):
    """Save or update a client's Web Push subscription."""
    try:
        data = json.loads(request.body.decode('utf-8'))
        subscription = data.get('subscription')
        if not subscription or not subscription.get('endpoint'):
            return JsonResponse({'success': False, 'error': 'Invalid subscription'}, status=400)

        db = get_db()
        user_id = str(request.session.get('user_id'))
        role = request.session.get('role', 'player')

        db.push_subscriptions.update_one(
            {'endpoint': subscription['endpoint']},
            {
                '$set': {
                    'endpoint': subscription['endpoint'],
                    'subscription': subscription,
                    'user_id': user_id,
                    'role': role,
                    'user_agent': request.META.get('HTTP_USER_AGENT', ''),
                    'updated_at': datetime.utcnow()
                }
            },
            upsert=True
        )
        return JsonResponse({'success': True})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@login_required_custom
@require_POST
def unsubscribe_push(request):
    """Remove a Web Push subscription."""
    try:
        data = json.loads(request.body.decode('utf-8'))
        endpoint = data.get('endpoint')
        if endpoint:
            db = get_db()
            db.push_subscriptions.delete_many({'endpoint': endpoint})
        return JsonResponse({'success': True})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@login_required_custom
def recent_notifications(request):
    """Return JSON with recent announcements and unread messages for the notification tray."""
    try:
        db = get_db()
        user_id = str(request.session.get('user_id'))

        # Latest 3 announcements
        announcements_cursor = db.announcements.find().sort('created_at', -1).limit(3)
        announcements = []
        for a in announcements_cursor:
            created = a.get('created_at')
            time_str = created.strftime('%b %d, %I:%M %p') if isinstance(created, datetime) else 'Recent'
            announcements.append({
                'id': str(a.get('_id', '')),
                'title': a.get('title', 'Announcement'),
                'content': (a.get('content', '')[:90] + '...') if len(a.get('content', '')) > 90 else a.get('content', ''),
                'time': time_str,
                'image': a.get('image') or None,
            })

        # Recent unread messages
        unread_cursor = db.messages.find({
            'receiver_id': user_id,
            'is_read': False
        }).sort('timestamp', -1).limit(3)

        unread_messages = []
        for m in unread_cursor:
            ts = m.get('timestamp')
            time_str = ts.strftime('%I:%M %p') if isinstance(ts, datetime) else 'Recent'
            sender = None
            sender_id_val = m.get('sender_id')
            if sender_id_val and ObjectId.is_valid(sender_id_val):
                sender = db.users.find_one({'_id': ObjectId(sender_id_val)})
            sender_name = sender.get('full_name') if sender else 'Club Desk'
            unread_messages.append({
                'sender_id': sender_id_val,
                'sender_name': sender_name,
                'message': m.get('message') or 'Sent a photo',
                'time': time_str,
            })

        # Total unread message count
        unread_total = db.messages.count_documents({
            'receiver_id': user_id,
            'is_read': False
        })

        return JsonResponse({
            'success': True,
            'announcements': announcements,
            'unread_messages': unread_messages,
            'unread_total': unread_total
        })
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)
