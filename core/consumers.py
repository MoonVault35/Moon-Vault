import json
from datetime import datetime
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from bson import ObjectId


class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        session = self.scope.get('session', {})
        self.user_id = session.get('user_id')
        self.role = session.get('role')

        if not self.user_id:
            await self.close()
            return

        # Each user gets their own group
        self.room_group_name = f'chat_{self.user_id}'

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, 'room_group_name'):
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )

    async def receive(self, text_data):
        data = json.loads(text_data)
        message = data.get('message', '').strip()
        receiver_id = data.get('receiver_id', '').strip()

        if not message or not receiver_id:
            return

        # Validate and save
        msg_data = await self.save_message(message, receiver_id)
        if not msg_data:
            return

        # Send to receiver's group
        receiver_group = f'chat_{receiver_id}'
        await self.channel_layer.group_send(
            receiver_group,
            {
                'type': 'chat_message',
                'message': message,
                'image': '',
                'sender_id': self.user_id,
                'receiver_id': receiver_id,
                'timestamp': msg_data['timestamp'],
                'msg_id': msg_data['id'],
            }
        )

        # Send confirmation to sender
        await self.send(text_data=json.dumps({
            'type': 'sent',
            'message': message,
            'image': '',
            'sender_id': self.user_id,
            'receiver_id': receiver_id,
            'timestamp': msg_data['timestamp'],
            'msg_id': msg_data['id'],
        }))

    async def chat_message(self, event):
        """Handle incoming chat message from channel layer."""
        await self.send(text_data=json.dumps({
            'type': 'received',
            'message': event.get('message', ''),
            'image': event.get('image', ''),
            'sender_id': event['sender_id'],
            'receiver_id': event['receiver_id'],
            'timestamp': event['timestamp'],
            'msg_id': event.get('msg_id', ''),
        }))

    async def chat_message_sent(self, event):
        """Handle sent confirmation from channel layer."""
        await self.send(text_data=json.dumps({
            'type': 'sent',
            'message': event.get('message', ''),
            'image': event.get('image', ''),
            'sender_id': event['sender_id'],
            'receiver_id': event['receiver_id'],
            'timestamp': event['timestamp'],
            'msg_id': event.get('msg_id', ''),
        }))

    @database_sync_to_async
    def save_message(self, message, receiver_id):
        from .db import get_db
        db = get_db()

        # Validate receiver exists
        if self.role == 'player':
            admin = db.admin.find_one()
            if not admin or str(admin['_id']) != receiver_id:
                return None
        else:
            try:
                player = db.players.find_one({'_id': ObjectId(receiver_id)})
                if not player:
                    return None
            except Exception:
                return None

        now = datetime.utcnow()
        msg_doc = {
            'sender_id': self.user_id,
            'receiver_id': receiver_id,
            'message': message,
            'timestamp': now,
            'is_read': False,
        }
        result = db.messages.insert_one(msg_doc)
        return {
            'id': str(result.inserted_id),
            'timestamp': now.strftime('%b %d, %I:%M %p'),
        }
