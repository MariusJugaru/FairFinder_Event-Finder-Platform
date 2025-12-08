from flask import Flask
from flask import request, session, jsonify, Response, send_from_directory
from flask import url_for, redirect

from flask_cors import CORS
from datetime import datetime, timedelta

from models import db
import jwt
import os
from werkzeug.utils import secure_filename

# Utils
from utils import *

app = Flask(__name__)
app.secret_key = "SECRET_KEY"

# DB Config
ACCESS_TOKEN_EXPIRES_MIN = 15
REFRESH_TOKEN_EXPIRES_DAYS = 7
app.config['SQLALCHEMY_DATABASE_URI'] = 'mysql+pymysql://admin:admin@localhost:3306/fair-finder-db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
UPLOAD_FOLDER = "uploads/avatars"
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif"}
db.init_app(app)
CORS(app)
def create_access_token(user_id):
    payload = {
        "user_id": user_id,
        "exp": datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRES_MIN),
        "type": "access"
    }
    return jwt.encode(payload, app.secret_key, algorithm="HS256")


def create_refresh_token(user_id):
    payload = {
        "user_id": user_id,
        "exp": datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRES_DAYS),
        "type": "refresh"
    }
    return jwt.encode(payload, app.secret_key, algorithm="HS256")

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
@app.route("/login", methods=["POST"])
def login():
    data = request.get_json()

    # verificam daca email-ul exista
    user = User.query.filter_by(email=data.get("email")).first()
    if not user:
        return jsonify({"error": "Invalid email or password"}), 401

    # verificam parola
    if not check_password_hash(user.password_hash, data.get("password")):
        return jsonify({"error": "Invalid email or password"}), 401

    # generam token-uri
    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)

    return jsonify({
        "message": "Login successful",
        "access_token": access_token,
        "refresh_token": refresh_token,
    }), 200

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

@app.route("/update_user/<int:user_id>", methods=["PUT"])
def update_user_endpoint(user_id):
    print(user_id)
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json()

    if "firstName" in data:
        user.first_name = data["firstName"]
    if "lastName" in data:
        user.last_name = data["lastName"]
    if "birthday" in data:
        try:
            user.birthday = datetime.fromisoformat(data["birthday"]).date()
        except Exception as e:
            return jsonify({"error": "Invalid birthday format"}), 400

    db.session.commit()
    return jsonify(user.to_dict()), 200
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route("/upload_avatar/<int:user_id>", methods=["POST"])
def upload_avatar(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    if 'avatar' not in request.files:
        return jsonify({"error": "No file part"}), 400

    file = request.files['avatar']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    if file and allowed_file(file.filename):
        os.makedirs(UPLOAD_FOLDER, exist_ok=True)
        filename = secure_filename(f"user_{user_id}_{file.filename}")
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        file.save(filepath)

        user.profile_picture = f"http://127.0.0.1:8081/uploads/avatars/{filename}"
        db.session.commit()

        return jsonify({"profilePicture": user.profile_picture}), 200

    return jsonify({"error": "Invalid file"}), 400
@app.route("/uploads/avatars/<filename>")
def uploaded_file(filename):
    return send_from_directory("uploads/avatars", filename)

@app.route("/get_event_part/<int:event_id>", methods=["GET"])
def get_event_part(event_id):
    return jsonify(get_event_participations(event_id)), 200

if __name__ == '__main__':
    with app.app_context():
        # db.drop_all()
        db.create_all()
    app.run('0.0.0.0', port=8081, debug=True)
