import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
@Component({
  selector: 'app-register',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss']
})
export class RegisterComponent implements OnInit {

  registerForm!: FormGroup;

  constructor(private fb: FormBuilder, private http: HttpClient, private router: Router) { }

  ngOnInit(): void {
    this.registerForm = this.fb.group({
      firstName: ['', Validators.required],
      lastName: ['', Validators.required],
      birthday: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required]
    });
  }

  get firstName() { return this.registerForm.get('firstName')!; }
  get lastName() { return this.registerForm.get('lastName')!; }
  get birthday() { return this.registerForm.get('birthday')!; }
  get email() { return this.registerForm.get('email')!; }
  get password() { return this.registerForm.get('password')!; }

  onRegister(): void {
    if (this.registerForm.valid) {

      // Format the date as YYYY-MM-DD
      const birthdayValue = this.registerForm.value.birthday;
      const formattedBirthday = new Date(birthdayValue).toISOString().split('T')[0];

      const payload = {
        first_name: this.registerForm.value.firstName,
        last_name: this.registerForm.value.lastName,
        birthday: formattedBirthday,
        email: this.registerForm.value.email,
        password: this.registerForm.value.password
      };

      this.http.post('http://localhost:8081/register', payload)
        .subscribe({
          next: (res) => {
            console.log('Registration successful:', res);
            this.router.navigate(['/login']);
          },
          error: (err) => {
            console.error('Registration failed:', err);
          }
        });
    }
  }
}
