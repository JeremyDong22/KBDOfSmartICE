// Version: 3.3 - Two-query approach for reliable brand_id fetch at login
// Authentication service with type safety

import { supabaseClient } from './supabase';
import type { Employee, LoginResponse } from '@/types/models';

export class AuthService {
  private static readonly STORAGE_KEY = 'currentUser';

  /**
   * Login with username and password
   * Uses custom authentication via master_employee table (not Supabase Auth SDK)
   * Fetches brand_id from master_restaurant to cache it for faster page loads
   */
  static async login(username: string, password: string): Promise<LoginResponse> {
    try {
      // 1. Query master_employee for authentication
      const { data: empData, error: empError } = await supabaseClient
        .from('master_employee')
        .select('*')
        .eq('username', username)
        .eq('password_hash', password)
        .eq('is_active', true)
        .single();

      if (empError) throw empError;
      if (!empData) throw new Error('用户名或密码错误');

      const rawEmployee = empData as any;

      // Check if account is locked
      if (rawEmployee.is_locked) {
        throw new Error('账号已被锁定，请联系管理员');
      }

      // 2. Fetch brand_id from master_restaurant (parallel-safe for future)
      let brandId: number | undefined;
      try {
        const { data: restData } = await supabaseClient
          .from('master_restaurant')
          .select('brand_id')
          .eq('id', rawEmployee.restaurant_id)
          .single();
        brandId = (restData as any)?.brand_id;
      } catch {
      }

      // Build employee object with brand_id
      const employee: Employee = {
        id: rawEmployee.id,
        username: rawEmployee.username,
        password_hash: rawEmployee.password_hash,
        employee_name: rawEmployee.employee_name,
        restaurant_id: rawEmployee.restaurant_id,
        role_code: rawEmployee.role_code,
        is_active: rawEmployee.is_active,
        is_locked: rawEmployee.is_locked,
        login_failed_count: rawEmployee.login_failed_count,
        profile_photo_url: rawEmployee.profile_photo_url,
        brand_id: brandId, // Cache brand_id for faster page loads
        created_at: rawEmployee.created_at,
        updated_at: rawEmployee.updated_at
      };

      // Store session in sessionStorage
      sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(employee));

      return { success: true, user: employee };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
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
      return null;
    }
  }

  /**
   * Logout current user
   */
  static logout(): void {
    sessionStorage.removeItem(this.STORAGE_KEY);
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
