from django.urls import path
from . import views

urlpatterns = [
    # Public
    path('', views.landing, name='landing'),
    path('login/', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),

    # Home
    path('home/', views.home, name='home'),

    # Players
    path('players/', views.players_list, name='players_list'),
    path('players/add/', views.player_add, name='player_add'),
    path('players/<str:player_id>/edit/', views.player_edit, name='player_edit'),
    path('players/<str:player_id>/delete/', views.player_delete, name='player_delete'),
    path('players/<str:player_id>/toggle-status/', views.player_toggle_status, name='player_toggle_status'),

    # Chat
    path('chat/', views.chat, name='chat'),
    path('chat/messages/<str:player_id>/', views.chat_messages, name='chat_messages'),
    path('chat/send/', views.chat_send, name='chat_send'),
    path('chat/mark-read/<str:player_id>/', views.chat_mark_read, name='chat_mark_read'),
    path('chat/unread-counts/', views.chat_unread_counts, name='chat_unread_counts'),

    # Support
    path('support/', views.support, name='support'),
    path('support/edit/', views.support_edit, name='support_edit'),

    # Announcements
    path('announcements/', views.announcements_list, name='announcements'),
    path('announcements/add/', views.announcement_add, name='announcement_add'),
    path('announcements/<str:announcement_id>/edit/', views.announcement_edit, name='announcement_edit'),
    path('announcements/<str:announcement_id>/delete/', views.announcement_delete, name='announcement_delete'),

    # Payment Methods (previously tags)
    path('tags/', views.payment_methods, name='tags'),
    path('payment-methods/', views.payment_methods, name='payment_methods'),
    path('payment-methods/add/', views.payment_method_add, name='payment_method_add'),
    path('payment-methods/<str:method_id>/edit/', views.payment_method_edit, name='payment_method_edit'),
    path('payment-methods/<str:method_id>/delete/', views.payment_method_delete, name='payment_method_delete'),

    # Password
    path('change-password/', views.change_password, name='change_password'),

    # Web Push Notifications
    path('sw.js', views.service_worker, name='service_worker'),
    path('api/save-subscription/', views.save_push_subscription, name='save_push_subscription'),
    path('api/unsubscribe-push/', views.unsubscribe_push, name='unsubscribe_push'),
]
