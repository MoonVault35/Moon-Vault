from django import template

register = template.Library()


@register.filter
def get_item(dictionary, key):
    """Get an item from a dictionary by key."""
    if isinstance(dictionary, dict):
        return dictionary.get(key, '')
    return ''


@register.filter
def truncate_chars(value, max_length):
    """Truncate a string to max_length characters."""
    if len(str(value)) > max_length:
        return str(value)[:max_length] + '...'
    return value
