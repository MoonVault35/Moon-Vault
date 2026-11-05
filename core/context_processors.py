from django.conf import settings
from .db import get_db


def global_context(request):
    """Add global context variables available in all templates."""
    context = {
        'user_id': request.session.get('user_id'),
        'user_role': request.session.get('role'),
        'username': request.session.get('username'),
        'full_name': request.session.get('full_name', ''),
        'is_authenticated': 'user_id' in request.session,
        'is_admin': request.session.get('role') == 'admin',
        'is_player': request.session.get('role') == 'player',
        'vapid_public_key': getattr(settings, 'VAPID_PUBLIC_KEY', ''),
    }

    # Get unread message count
    if context['is_authenticated']:
        try:
            db = get_db()
            user_id = request.session.get('user_id')
            unread_count = db.messages.count_documents({
                'receiver_id': user_id,
                'is_read': False
            })
            context['unread_message_count'] = unread_count
        except Exception:
            context['unread_message_count'] = 0

    return context
