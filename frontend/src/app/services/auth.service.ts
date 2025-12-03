import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  private API_URL = 'http://127.0.0.1:8081'; // backend-ul tău

  constructor(private http: HttpClient) { }

  login(credentials: { email: string, password: string }): Observable<any> {
    return this.http.post(`${this.API_URL}/login`, credentials);
  }

  saveTokens(access: string, refresh: string) {
    localStorage.setItem("access_token", access);
    localStorage.setItem("refresh_token", refresh);
  }

  logout() {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
  }

  isLoggedIn(): boolean {
    return !!localStorage.getItem("access_token");
  }
}
