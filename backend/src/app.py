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

from datetime import datetime
@app.route("/register", methods=["POST"])
def register():
    data = request.get_json()

    is_valid, error_response = validate_register_data(data)
    
    if not is_valid:
        return jsonify(error_response), 400

    if User.query.filter_by(email=data['email']).first():
        return jsonify({"status": "Email already exists"}), 409

    try:
        new_user = create_user(data)
        return jsonify({
            "message": "User registered successfully",
            "user": new_user.to_dict()
        }), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500
    
@app.route("/get_users", methods=["GET"])
def get_users():
    return jsonify(get_all_users()), 200

@app.route("/post_event", methods=["GET", "POST"])
def post_event():
    if request.method == "POST":
        data = request.get_json()

        status, message = validate_post_request(data, PostFields.event.value)
        if not status:
            return jsonify(message), 400
        
        create_event(data)
        return redirect(url_for("home"))
    else:
        # TODO: Return TBD.
        return "TODO"

@app.route("/get_events", methods=["GET"])
def get_events():
    return jsonify(get_all_events()), 200

@app.route("/post_participation", methods=["GET", "POST"])
def post_participation():
    if request.method == "POST":
        data = request.get_json()

        status, message = validate_post_request(data, PostFields.participation.value)
        if not status:
            return jsonify(message), 400

        create_participation(data)
        return redirect(url_for("home"))
    else:
        # TODO: Return TBD.
        return "TODO"

@app.route("/get_participations", methods=["GET"])
def get_participations():
    return jsonify(get_all_participations()), 200

@app.route("/delete", methods=["GET"])
def delete():
    return delete_all_participations()

@app.route("/get_user", methods=["GET"])
def get_user_endpoint():
    user_id = request.args.get("user_id", type = int)
    if user_id is None:
        return jsonify({"error": "Missing user_id parameter"}), 400
    
    return jsonify(get_user(user_id)), 200

@app.route("/get_event", methods=["GET"])
def get_event_endpoint():
    event_id = request.args.get("event_id", type = int)
    if event_id is None:
        return jsonify({"error": "Missing event_id parameter"}), 400
    
    return jsonify(get_event(event_id)), 200

@app.route("/get_participation", methods=["GET"])
def get_participation_endpoint():
    user_id = request.args.get("user_id", type = int)
    if user_id is None:
        return jsonify({"error": "Missing user_id parameter"}), 400
    event_id = request.args.get("event_id", type = int)
    if event_id is None:
        return jsonify({"error": "Missing event_id parameter"}), 400
    
    return jsonify(get_participation(user_id, event_id)), 200


@app.route("/get_user_part/<int:user_id>", methods=["GET"])
def get_user_part(user_id):
    return jsonify(get_user_participations(user_id)), 200

@app.route("/get_event_part/<int:event_id>", methods=["GET"])
def get_event_part(event_id):
    return jsonify(get_event_participations(event_id)), 200

if __name__ == '__main__':
    with app.app_context():
        # db.drop_all()
        db.create_all()
    app.run('0.0.0.0', port=8081, debug=True)
