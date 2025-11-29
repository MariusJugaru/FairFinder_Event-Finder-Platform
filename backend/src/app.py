from flask import Flask
from flask import request, session, jsonify, Response
from flask import url_for, redirect

from flask_cors import CORS

from models import db

# Utils
from utils import *

app = Flask(__name__)
app.secret_key = "SECRET_KEY"

# DB Config
app.config['SQLALCHEMY_DATABASE_URI'] = 'mysql+pymysql://admin:admin@localhost:3306/fair-finder-db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)
CORS(app)

@app.route("/")
def home():


    return "Okay"

@app.route("/test_post", methods=["POST"])
def test_post():
    data = request.get_json()
    add_test(data["text"])
    return jsonify({"status": "okay"}), 200

@app.route("/test_get", methods=["GET"])
def test_get():
    return jsonify(get_test()), 200

if __name__ == '__main__':
    with app.app_context():
        # db.drop_all()
        db.create_all()
    app.run('0.0.0.0', port=8081, debug=True)
