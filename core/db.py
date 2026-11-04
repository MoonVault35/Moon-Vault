import pymongo
from django.conf import settings

_client = None


def get_client():
    """Get or create the MongoDB client (singleton)."""
    global _client
    if _client is None:
        client_kwargs = {}
        try:
            import certifi
            client_kwargs['tlsCAFile'] = certifi.where()
        except ImportError:
            pass
        _client = pymongo.MongoClient(settings.MONGODB_URI, **client_kwargs)
    return _client


def get_db():
    """Get the MongoDB database instance."""
    client = get_client()
    return client[settings.MONGODB_NAME]


def generate_player_id():
    """Generate a sequential player ID like PLR-0001."""
    db = get_db()
    counter = db.counters.find_one_and_update(
        {'_id': 'player_id'},
        {'$inc': {'seq': 1}},
        upsert=True,
        return_document=pymongo.ReturnDocument.AFTER
    )
    return f"PLR-{counter['seq']:04d}"
