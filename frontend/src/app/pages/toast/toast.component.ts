import { Component, OnInit } from '@angular/core';
import { ToastService, ToastMessage } from 'src/app/services/toast.service';

@Component({
  selector: 'app-toast',
  templateUrl: './toast.component.html',
  styleUrls: ['./toast.component.scss']
})
export class ToastComponent implements OnInit {

  message: ToastMessage | null = null;
  isVisible = false;

  constructor(private toastService: ToastService) { }

  ngOnInit() {
    this.toastService.toast$.subscribe(msg => {
      if (!msg) return;

      this.message = msg;
      this.isVisible = true;

      setTimeout(() => {
        this.isVisible = false;

        setTimeout(() => {
          this.message = null;
        }, 300);
      }, 3000);
    });
  }
}