import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { ToastService } from './toast.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  private API_URL = 'http://127.0.0.1:8081'; // backend-ul tău

  constructor(private http: HttpClient, private toast: ToastService) { }
  private authState = new BehaviorSubject<boolean>(this.checkInitialTokenState());
  authState$ = this.authState.asObservable();
  login(credentials: { email: string, password: string }): Observable<any> {
    return this.http.post(`${this.API_URL}/login`, credentials);
  }

  saveTokens(access: string, refresh: string) {
    localStorage.setItem("access_token", access);
    localStorage.setItem("refresh_token", refresh);
    this.authState.next(true);
  }

  logout() {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    this.authState.next(false);
  }

  isLoggedIn(): boolean {
    const token = this.getToken();

    if (!token) {
      return false;
    }

    if (this.isTokenExpired(token)) {
      this.logout();
      this.toast.showToast("Session expired. Please log in again to access all functionalities.", "warning");
      return false;
    }

    return true;
  }
  getUserId(): number | null {
    const token = localStorage.getItem('access_token');
    if (!token) return null;
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.user_id;
  }
  getToken() {
    return localStorage.getItem("access_token");
  }
  private isTokenExpired(token: string): boolean {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));

      if (!payload.exp) {
        return false;
      }

      const currentTime = Math.floor(Date.now() / 1000);

      return currentTime >= payload.exp;

    } catch (e) {
      return true;
    }
  }
  private checkInitialTokenState(): boolean {
    const token = localStorage.getItem("access_token");
    if (!token) return false;
    return !this.isTokenExpiredSimple(token);
  }



  private isTokenExpiredSimple(token: string): boolean {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (!payload.exp) return false;
      const currentTime = Math.floor(Date.now() / 1000);
      return currentTime >= payload.exp;
    } catch (e) { return true; }
  }
}
