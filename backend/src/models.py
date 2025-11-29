from flask_sqlalchemy import SQLAlchemy

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