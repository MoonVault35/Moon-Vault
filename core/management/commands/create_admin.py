import getpass
from django.core.management.base import BaseCommand
from django.contrib.auth.hashers import make_password
from pymongo.errors import PyMongoError
from core.db import get_db


class Command(BaseCommand):
    help = 'Create the single admin account for the Football Manager website'

    def add_arguments(self, parser):
        parser.add_argument('--username', type=str, help='Admin username')
        parser.add_argument('--password', type=str, help='Admin password')

    def handle(self, *args, **options):
        try:
            db = get_db()
            # Check if admin already exists
            existing = db.admin.find_one()
        except PyMongoError as exc:
            self.stdout.write(self.style.ERROR(f'\n[MongoDB Connection Error]: {exc}\n'))
            self.stdout.write(self.style.WARNING(
                'Please ensure your real MongoDB Atlas connection string is configured in your .env file:\n'
                '  MONGODB_URI=mongodb+srv://<username>:<password>@<your-cluster>.mongodb.net/?retryWrites=true&w=majority\n\n'
                'Or if testing locally:\n'
                '  MONGODB_URI=mongodb://localhost:27017/\n'
            ))
            return

        if existing:
            self.stdout.write(self.style.WARNING('An admin account already exists.'))
            confirm = input('Do you want to reset it? (yes/no): ')
            if confirm.lower() != 'yes':
                self.stdout.write(self.style.ERROR('Aborted.'))
                return
            db.admin.delete_many({})

        username = options.get('username')
        if not username:
            username = input('Enter admin username: ')

        password = options.get('password')
        if not password:
            password = getpass.getpass('Enter admin password: ')
            password_confirm = getpass.getpass('Confirm admin password: ')
            if password != password_confirm:
                self.stdout.write(self.style.ERROR('Passwords do not match.'))
                return

        if len(password) < 6:
            self.stdout.write(self.style.ERROR('Password must be at least 6 characters.'))
            return

        admin_doc = {
            'username': username,
            'password_hash': make_password(password),
            'role': 'admin'
        }
        db.admin.insert_one(admin_doc)

        # Initialize support contacts if not exists
        if not db.support_contacts.find_one():
            db.support_contacts.insert_one({
                'facebook_page_url': '',
                'messenger_url': '',
                'contact_number': '',
                'alternative_number': '',
                'support_message': 'For any inquiries, please reach out through our official channels below.'
            })

        self.stdout.write(self.style.SUCCESS(f'Admin account "{username}" created successfully!'))
