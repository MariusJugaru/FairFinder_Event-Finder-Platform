from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import Enum, UniqueConstraint
import json
from werkzeug.security import generate_password_hash, check_password_hash
from geoalchemy2 import Geometry
from geoalchemy2.shape import to_shape
from shapely.geometry import mapping

from datetime import datetime, timezone


db = SQLAlchemy()

class TestTable(db.Model):
    __tablename__ = "test"
    id = db.Column(db.Integer, primary_key = True, autoincrement = True)
    test_field = db.Column(db.String(100), nullable = False)

    def to_dict(self):
        return {
            "id": self.id,
            "test_field": self.test_field
        }
    
class User(db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key = True, autoincrement = True)
    first_name = db.Column(db.String(40), nullable = False)
    last_name = db.Column(db.String(60), nullable = False)
    email = db.Column(db.String(50), unique=True, nullable = False)
    password_hash = db.Column(db.String(200), nullable = False)
    birthday = db.Column(db.Date, nullable = False)
    created_at = db.Column(db.DateTime, default = lambda: datetime.now(timezone.utc), nullable = False)
    profile_picture = db.Column(db.String(200), nullable=True)
    events = db.relationship("Event", back_populates = "owner", cascade = "all, delete-orphan")
    participations = db.relationship("Participation", back_populates = "user", cascade = "all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "firstName": self.first_name,
            "lastName": self.last_name,
            "email": self.email,
            # "password_hash": self.password_hash,
            "birthday": self.birthday.isoformat(),
            "created_at": self.created_at.isoformat(),
            "profilePicture": self.profile_picture
        }
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

class Event(db.Model):
    __tablename__ = "events"
    id = db.Column(db.Integer, primary_key = True, autoincrement = True)
    owner_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id", ondelete = "CASCADE"),
        nullable = False)
    title = db.Column(db.String(40), nullable = False)
    description = db.Column(db.String(300), nullable = False)
    start_time = db.Column(db.DateTime, nullable = False)
    end_time = db.Column(db.DateTime, nullable = False)
    created_at = db.Column(db.DateTime, default = lambda: datetime.now(timezone.utc), nullable = False)
    geometry = db.Column(Geometry(), nullable = False)
    color = db.Column(db.String(9), nullable = False)

    owner = db.relationship("User", back_populates = "events")
    participations = db.relationship("Participation", back_populates = "event", cascade = "all, delete-orphan")

    def to_dict(self):
        geom_geojson = mapping(to_shape(self.geometry))

        return {
            "id": self.id,
            "owner_id": self.owner_id,
            "title": self.title,
            "description": self.description,
            "start_time": self.start_time.isoformat(),
            "end_time": self.end_time.isoformat(),
            "created_at": self.created_at.isoformat(),
            "geometry": geom_geojson,
            "color": self.color
        }
    
class Participation(db.Model):
    __tablename__ = "participations"
    id = db.Column(db.Integer, primary_key = True, autoincrement = True)
    user_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id", ondelete = "CASCADE"),
        nullable = False
    )
    event_id = db.Column(
        db.Integer,
        db.ForeignKey("events.id", ondelete = "CASCADE"),
        nullable = False
    )
    status = db.Column(
        Enum("Going", "Not going", "Interested", name="event_status"),
        nullable = False,
        default = "Interested"
    )

    user = db.relationship("User", back_populates = "participations")
    event = db.relationship("Event", back_populates = "participations")

    __table_args__ = (
        UniqueConstraint('user_id', 'event_id', name='unique_user_event'),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "event_id": self.event_id,
            "status": self.status
        }
