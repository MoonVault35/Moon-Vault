from django.conf import settings
from django.urls import path, include, re_path
from core.media_storage import serve_media

urlpatterns = [
    path('', include('core.urls')),
    re_path(r'^media/(?P<path>.*)$', serve_media, name='serve_media'),
]
