// Version: 3.0 - TypeScript migration of AuthService
// Authentication service with type safety

import { supabaseClient } from './supabase';
import type { Employee, LoginResponse } from '@/types/models';

export class AuthService {
  private static readonly STORAGE_KEY = 'currentUser';

  /**
   * Login with username and password
   * Uses custom authentication via master_employee table (not Supabase Auth SDK)
   */
  static async login(username: string, password: string): Promise<LoginResponse> {
    try {
      // Query master_employee table for authentication
      const { data, error } = await supabaseClient
        .from('master_employee')
        .select('*')
        .eq('username', username)
        .eq('password_hash', password)
        .eq('is_active', true)
        .single();

      if (error) throw error;
      if (!data) throw new Error('用户名或密码错误');

      const employee = data as unknown as Employee;

      // Check if account is locked
      if (employee.is_locked) {
        throw new Error('账号已被锁定，请联系管理员');
      }

      // Store session in sessionStorage
      sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(employee));

      console.log('[AuthService] Login successful:', employee.employee_name);
      return { success: true, user: employee };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[AuthService] Login error:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get current logged in user from sessionStorage
   */
  static getCurrentUser(): Employee | null {
    try {
      const userStr = sessionStorage.getItem(this.STORAGE_KEY);
      if (!userStr) return null;

      const user = JSON.parse(userStr) as Employee;
      return user;
    } catch (error) {
      console.error('[AuthService] Error getting current user:', error);
      return null;
    }
  }

  /**
   * Logout current user
   */
  static logout(): void {
    sessionStorage.removeItem(this.STORAGE_KEY);
    console.log('[AuthService] User logged out');
    window.location.href = '/';
  }

  /**
   * Check if user is authenticated
   */
  static isAuthenticated(): boolean {
    return !!this.getCurrentUser();
  }
}

// Expose to window for backward compatibility with HTML onclick handlers
if (typeof window !== 'undefined') {
  window.AuthService = AuthService;
}
