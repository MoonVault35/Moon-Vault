import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'football_manager.settings')
django.setup()

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.sessions import SessionMiddlewareStack
from django.core.asgi import get_asgi_application
from core.routing import websocket_urlpatterns

django_asgi_app = get_asgi_application()

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': SessionMiddlewareStack(
        URLRouter(websocket_urlpatterns)
    ),
})
