from models import db
from models import TestTable

def add_test(text: str):
    new_test = TestTable(test_field=text)
    db.session.add(new_test)
    db.session.commit()
    return True

def get_test():
    tests = TestTable.query.all()
    return [test.to_dict() for test in tests]