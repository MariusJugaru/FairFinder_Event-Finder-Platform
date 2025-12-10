import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface ToastMessage {
    type: 'success' | 'error' | 'info' | 'warning';
    text: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
    private toastSubject = new BehaviorSubject<ToastMessage | null>(null);
    toast$ = this.toastSubject.asObservable();

    showToast(text: string, type: 'success' | 'error' | 'info' | 'warning' = 'success') {
        this.toastSubject.next({ text, type });
    }

    success(text: string) {
        this.showToast(text, 'success');
    }

    error(text: string) {
        this.showToast(text, 'error');
    }

    info(text: string) {
        this.showToast(text, 'info');
    }

    warning(text: string) {
        this.showToast(text, 'warning');
    }
}
