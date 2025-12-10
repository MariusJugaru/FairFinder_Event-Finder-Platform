from functools import wraps
from flask import request, jsonify
import jwt

SECRET_KEY = "SECRET_KEY" 
def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get("Authorization")
        if not auth_header:
            print("missing")
            return jsonify({"error": "Missing token"}), 401
        
        try:
            token = auth_header.split(" ")[1]
            data = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
            request.user_id = data["user_id"]
        except Exception:
            print("WTF")
            return jsonify({"error": "Invalid token"}), 401
        
        return f(*args, **kwargs)

    return wrapper
