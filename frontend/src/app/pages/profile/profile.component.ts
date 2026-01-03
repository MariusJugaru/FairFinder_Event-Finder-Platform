import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from 'src/app/services/auth.service';
import { ToastService } from 'src/app/services/toast.service';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss']
})
export class ProfileComponent implements OnInit {

  profileForm: FormGroup;
  user: any;
  userId: number;

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private http: HttpClient,
    private authService: AuthService,
    private router: Router,
    private toast: ToastService
  ) { }

  ngOnInit() {
    // luam userId din URL
    this.userId = +this.route.snapshot.paramMap.get('id')!;

    // initializam form-ul cu valori goale
    this.profileForm = this.fb.group({
      firstName: ['', Validators.required],
      lastName: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      gender: ['N', Validators.required]
    });
    const loggedIn = this.authService.getUserId();
    //if (loggedIn!=this.userId){
    //  this.router.navigate()
    //}
    this.loadUser();
  }

  loadUser() {
    this.http.get<any>(`http://127.0.0.1:8081/get_user?user_id=${this.userId}`)
      .subscribe({
        next: (data) => {
          this.user = data;
          console.log(this.user);
          this.profileForm.patchValue({
            firstName: this.user.firstName,
            lastName: this.user.lastName,
            email: this.user.email,
            gender: this.user.gender || 'N'
          });
        },
        error: (err) => {
          console.error('Failed to load user', err);
          this.toast.showToast('Not authorized to view this profile.', 'error');
        }
      });
  }

  onProfilePicChange(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('avatar', file);

    this.http.post<{ profilePicture: string }>(
      `http://127.0.0.1:8081/upload_avatar/${this.userId}`,
      formData
    ).subscribe({
      next: (res) => {
        this.user.profilePicture = res.profilePicture;
      },
      error: (err) => {
        console.error('Failed to upload avatar', err);
        alert('Failed to upload avatar');
      }
    });
  }

  onSave() {
    if (this.profileForm.valid) {
      const updatedUser = {
        firstName: this.profileForm.value.firstName,
        lastName: this.profileForm.value.lastName,
        email: this.profileForm.value.email,
        gender: this.profileForm.value.gender
      };

      this.http.put<any>(`http://127.0.0.1:8081/update_user/${this.userId}`, updatedUser)
        .subscribe({
          next: () => {
            console.log('Profile updated.');
            this.toast.showToast("Profile updated succesfully!", 'success');
          },
          error: (err) => {
            console.error('Failed to update user', err);
            alert('Failed to update profile');
          }
        });
    }
  }

  goToMap() {
    this.router.navigate(['/map'], { queryParams: { someParam: 'value' } });
  }
}
