from datetime import datetime, timezone

from enum import Enum
from models import db
from models import TestTable
from models import User, Event, Participation
from werkzeug.security import generate_password_hash

from geoalchemy2.shape import from_shape
from shapely.geometry import shape

def add_test(text: str):
    new_test = TestTable(test_field=text)
    db.session.add(new_test)
    db.session.commit()
    return True

def get_test():
    tests = TestTable.query.all()
    return [test.to_dict() for test in tests]

def create_user(data: dict) -> User:
    """
    Adds a new user to the DB.
    
    Args:
        data (dict): {
            "first_name": str,  # max 40
            "last_name": str,   # max 60
            "email": str,       # max 50
            "password": str,    # not hash
            "birthday": str     # format "YYYY-MM-DD"
        }

    Returns:
        A new user object.
    """

    try:
        birthday = datetime.strptime(data["birthday"], "%Y-%m-%d").date()
    except ValueError:
        raise ValueError("Invalid birthday format. <YYYY-MM-DD>.")

    user = User(
        first_name=data["first_name"],
        last_name=data["last_name"],
        email=data["email"],
        birthday=data["birthday"]
    )
    user.password_hash = generate_password_hash(data["password"])

    db.session.add(user)
    db.session.commit()

    return user

def get_all_users() -> list:
    """
    Returns:
        The list of the users in the DB.
    """

    users = User.query.all()
    return [user.to_dict() for user in users]

def get_user(user_id: int) -> dict:
    """
    Returns user info by id.
    """

    user = User.query.filter_by(id = user_id).first()
    if user is None:
        return {}
    return user.to_dict()

def create_event(data: dict) -> Event:
    """
    Creates a new event.

    Args:
        data (dict): {
            "owner_id": int,
            "title": str,       # max 40
            "description": str, # max 300
            "start_time": str,  # "YYYY-MM-DDTHH:MM"
            "end_time": str,    # "YYYY-MM-DDTHH:MM"
            "geometry": GeoJSON #   {
                                    "type": "Point",
                                    "coordinates": [25.3, 45.2]
                                    }
            "color": str        # max 9
        }
    
    Returns:
        A new event object.
    """

    try:
        start_time = datetime.fromisoformat(data["start_time"])
        end_time = datetime.fromisoformat(data["end_time"])
    except ValueError:
        raise ValueError("start_time or end_time not in format <YYYY-MM-DDTHH:MM>")
    
    try:
        geom_shape = shape(data["geometry"])
        geom_db = from_shape(geom_shape)
    except Exception as e:
        raise ValueError(f"Invalid geometry: {e}")
    
    event = Event(
        owner_id = data["owner_id"],
        title = data["title"],
        description = data["description"],
        start_time = start_time,
        end_time = end_time,
        geometry = geom_db,
        color = data["color"]
    )

    db.session.add(event)
    db.session.commit()

    return event

def get_all_events() -> list:
    events = Event.query.all()
    return [event.to_dict() for event in events]

def get_event(event_id: int) -> dict:
    """
    Returns event info by event id.
    """

    event = Event.query.filter_by(id = event_id).first()
    if event is None:
        return {}
    return event.to_dict()

def create_participation(data: dict) -> Participation:
    """
    Create a new participation.

    Args:
        data (dict): {
            "user_id": int,
            "event_id": int,
            "status": str,      # "Going", "Not going", "Interested"
        }

    Returns:
        A new participation object if user didn't express intent yet.
        Otherwise, change status and return the participation object.
    """
    participation = Participation.query.filter_by(user_id = data["user_id"], event_id = data["event_id"]).first()

    if participation:
        participation.status = data["status"]
    else:
        participation = Participation(
            user_id = data["user_id"],
            event_id = data["event_id"],
            status = data["status"]
        )
        db.session.add(participation)
    db.session.commit()

    return participation

def get_all_participations() -> list:
    participations = Participation.query.all()
    return [participation.to_dict() for participation in participations]

def get_participation(user_id: int, event_id: int) -> dict:
    """
    Return participation info by user and event id.
    """

    participation = Participation.query.filter_by(user_id = user_id, event_id = event_id).first()
    if participation is None:
        return {}
    return participation.to_dict()

def delete_all_participations():
    try:
        num_deleted = Participation.query.delete()  # șterge toate rândurile
        db.session.commit()
        return f"{num_deleted} participations deleted successfully."
    except Exception as e:
        db.session.rollback()
        return f"Error deleting participations: {str(e)}"

# Extra methods.

def get_user_participations(user_id: int):
    """
    Returns all participations for an user.
    """

    participations = Participation.query.filter_by(user_id = user_id).all()

    res = []
    participation: Participation
    for participation in participations:
        event_info = participation.event.to_dict()
        info = {
            "event": event_info,
            "status": participation.status
        }
        res.append(info)

    return res

def get_event_participations(event_id: int):
    """
    Returns all participations for an event.
    """

    participations = Participation.query.filter_by(event_id = event_id).all()

    res = []
    participation: Participation
    for participation in participations:
        user_info = participation.user.to_dict()
        info = {
            "user": user_info,
            "status": participation.status
        }
        res.append(info)

    return res


# Validation

class PostFields(Enum):
    register = {
        "first_name": str,
        "last_name": str,
        "email": str,
        "password": str,
        "birthday": str
    }
    event = {
        "owner_id": int,
        "title": str,
        "description": str,
        "start_time": str,
        "end_time": str,
        "geometry": dict,
        "color": str
    }
    participation = {
        "user_id": int,
        "event_id": int,
        "status": str
    }

def validate_post_request(data: dict, fields: dict):
    """
    Method for validating a post request and its fields.
    
    Args:
        data = the JSON post request.

        fields = {
            "field1": data_type,
            "field2": data_type2,
            ...
        }

    Return:
        False, Error message if validation fails.
        True, {} if validation succeeds.
    """

    if data is None:
        return False, {"status": "Missing JSON data."}
    
    for field, field_type in fields.items():
        if field not in data:
            return False, {"status": f"Missing field: {field}"}
        
        if field_type and not isinstance(data[field], field_type):
            return False, {"status": f"Invalid field for {field}. Expected {field_type}"}

    return True, {}