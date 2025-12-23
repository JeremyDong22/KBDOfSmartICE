// Version: 7.2 - Added 10MB video size limit and better error messages for uploads
// Check-in Module - Media recording and submission
// Handles: Image upload (multiple), voice recording, video upload (file picker), check-in submission

import { KBDService } from '@services/kbd.service';
import { AuthService } from '@services/auth.service';
import { MapModule } from '@modules/map';
import { UIModule } from '@modules/ui';

// Conditionally import TimeControlModule only in development
let TimeControlModule: typeof import('@modules/time-control').TimeControlModule | null = null;
if (import.meta.env.DEV) {
  import('@modules/time-control').then(m => {
    TimeControlModule = m.TimeControlModule;
  });
}


// Compression constants
const IMAGE_MAX_SIZE_KB = 200;
const VIDEO_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB limit for video (reasonable for mobile upload)

export class CheckInModule {
  // State
  static currentMediaFiles: File[] = [];  // Changed to array for multiple images
  static mediaRecorder: MediaRecorder | null = null;
  static audioChunks: Blob[] = [];
  static videoStream: MediaStream | null = null;
  static isVideoRecording: boolean = false;
  static videoChunks: Blob[] = [];  // Track video chunks for size monitoring
  static videoCurrentSize: number = 0;  // Track accumulated size

  /**
   * Compress image to target size (200KB default)
   * Uses canvas to resize and reduce JPEG quality
   */
  static async compressImage(file: File, maxSizeKB: number = IMAGE_MAX_SIZE_KB): Promise<File> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();

      reader.onload = (e) => {
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas not supported'));
            return;
          }

          // Start with original dimensions
          let width = img.width;
          let height = img.height;

          // If image is very large, scale down first
          const maxDimension = 1920;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);

          // Try different quality levels to get under maxSizeKB
          let quality = 0.9;
          let blob: Blob | null = null;

          const tryCompress = () => {
            canvas.toBlob(
              (result) => {
                if (!result) {
                  reject(new Error('Compression failed'));
                  return;
                }

                blob = result;
                const sizeKB = blob.size / 1024;

                if (sizeKB <= maxSizeKB || quality <= 0.1) {
                  // Done compressing
                  const compressedFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
                    type: 'image/jpeg',
                    lastModified: Date.now()
                  });
                  resolve(compressedFile);
                } else {
                  // Reduce quality and try again
                  quality -= 0.1;

                  // If still too large, also reduce dimensions
                  if (quality < 0.5 && sizeKB > maxSizeKB * 2) {
                    width = Math.round(width * 0.8);
                    height = Math.round(height * 0.8);
                    canvas.width = width;
                    canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);
                  }

                  tryCompress();
                }
              },
              'image/jpeg',
              quality
            );
          };

          tryCompress();
        };

        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target?.result as string;
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Initialize check-in module event listeners
   */
  static initialize(): void {

    // Image upload handler - correct element ID
    const imageFileInput = document.getElementById('imageFileInput') as HTMLInputElement;
    if (imageFileInput) {
      imageFileInput.addEventListener('change', (e) => this.handleImageUpload(e));
    }

    // Video upload handler
    const videoFileInput = document.getElementById('videoFileInput') as HTMLInputElement;
    if (videoFileInput) {
      videoFileInput.addEventListener('change', (e) => this.handleVideoUpload(e));
    }

    // Text input handler - element ID is textContent in HTML
    const textContentEl = document.getElementById('textContent') as HTMLTextAreaElement;
    if (textContentEl) {
      textContentEl.addEventListener('input', () => {
        const submitBtn = document.getElementById('submitCheckInBtn') as HTMLButtonElement;
        if (submitBtn) {
          submitBtn.disabled = !textContentEl.value.trim();
        }
      });
    }

  }

  /**
   * Handle image file upload (supports multiple files with compression)
   */
  static async handleImageUpload(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const files = input.files;

    if (files && files.length > 0) {
      // Show loading state
      const submitBtn = document.getElementById('submitImageBtn') as HTMLButtonElement;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '压缩中...';
      }

      // Compress and add new files to existing array
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file) {
          try {
            const compressedFile = await this.compressImage(file);
            this.currentMediaFiles.push(compressedFile);
          } catch (error) {
            // Fallback to original file if compression fails
            this.currentMediaFiles.push(file);
          }
        }
      }

      // Update preview grid
      this.updateImagePreviewGrid();

      // Enable submit button
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '✓ 提交打卡';
      }
    }
  }

  /**
   * Update image preview grid with all selected images
   */
  static updateImagePreviewGrid(): void {
    const placeholder = document.getElementById('imagePlaceholder');
    const previewGrid = document.getElementById('imagePreviewGrid');

    if (!previewGrid) return;

    // Hide placeholder, show grid
    if (placeholder) placeholder.style.display = 'none';
    previewGrid.style.display = 'grid';

    // Clear existing previews
    previewGrid.innerHTML = '';

    // Add preview for each image
    this.currentMediaFiles.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'image-preview-item';

      const img = document.createElement('img');
      img.alt = `Preview ${index + 1}`;

      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.innerHTML = '×';
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        this.removeImage(index);
      };

      item.appendChild(img);
      item.appendChild(removeBtn);
      previewGrid.appendChild(item);
    });

    // Add "add more" button if less than 9 images
    if (this.currentMediaFiles.length < 9) {
      const addMore = document.createElement('div');
      addMore.className = 'add-more';
      addMore.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
      addMore.onclick = (e) => {
        e.stopPropagation();
        document.getElementById('imageFileInput')?.click();
      };
      previewGrid.appendChild(addMore);
    }
  }

  /**
   * Remove an image from the selection
   */
  static removeImage(index: number): void {
    this.currentMediaFiles.splice(index, 1);

    if (this.currentMediaFiles.length === 0) {
      // Show placeholder again
      const placeholder = document.getElementById('imagePlaceholder');
      const previewGrid = document.getElementById('imagePreviewGrid');
      if (placeholder) placeholder.style.display = 'block';
      if (previewGrid) previewGrid.style.display = 'none';

      // Disable submit button
      const submitBtn = document.getElementById('submitImageBtn') as HTMLButtonElement;
      if (submitBtn) submitBtn.disabled = true;
    } else {
      this.updateImagePreviewGrid();
    }
  }

  /**
   * Start voice recording
   */
  static async startRecording(event: Event): Promise<void> {
    event.preventDefault();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (e) => {
        this.audioChunks.push(e.data);
      };

      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        const audioFile = new File([audioBlob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });
        this.currentMediaFiles = [audioFile];

        // Show audio player
        const audioPlayer = document.getElementById('audioPlayer') as HTMLAudioElement;
        if (audioPlayer) {
          audioPlayer.src = URL.createObjectURL(audioBlob);
          audioPlayer.style.display = 'block';
        }

        // Enable submit button
        const submitBtn = document.getElementById('submitVoiceBtn') as HTMLButtonElement;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.style.display = 'block';
        }

      };

      this.mediaRecorder.start();

      // Update UI buttons
      const startBtn = document.getElementById('startRecordBtn') as HTMLButtonElement;
      const stopBtn = document.getElementById('stopRecordBtn') as HTMLButtonElement;

      if (startBtn) startBtn.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'inline-block';

    } catch (error) {
      alert('无法访问麦克风，请检查权限设置');
    }
  }

  /**
   * Stop voice recording
   */
  static stopRecording(event: Event): void {
    event.preventDefault();

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();

      // Stop all audio tracks
      this.mediaRecorder.stream.getTracks().forEach(track => track.stop());

      // Update UI buttons
      const startBtn = document.getElementById('startRecordBtn') as HTMLButtonElement;
      const stopBtn = document.getElementById('stopRecordBtn') as HTMLButtonElement;

      if (startBtn) startBtn.style.display = 'inline-block';
      if (stopBtn) stopBtn.style.display = 'none';

    }
  }

  /**
   * Handle video file selection (from camera capture or gallery)
   * Supports native video formats: mp4, mov, quicktime
   * Max size: 10MB (enforced for reasonable upload times)
   */
  static async handleVideoUpload(e: Event): Promise<void> {
    console.log('[Video] handleVideoUpload triggered');
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      console.log('[Video] No file selected');
      return;
    }

    console.log('[Video] File selected:', {
      name: file.name,
      type: file.type,
      size: `${(file.size / 1024 / 1024).toFixed(2)} MB`
    });

    // Validate file type - accept common video formats
    const validTypes = ['video/mp4', 'video/quicktime', 'video/mov', 'video/mpeg', 'video/3gpp'];
    if (!validTypes.some(type => file.type.includes(type.split('/')[1]!)) && !file.type.startsWith('video/')) {
      console.log('[Video] Invalid file type:', file.type);
      alert('请选择有效的视频文件 (MP4, MOV 等)');
      return;
    }

    // Check file size - enforce 10MB limit for reasonable upload times
    if (file.size > VIDEO_MAX_SIZE_BYTES) {
      const sizeMB = (file.size / 1024 / 1024).toFixed(1);
      const maxMB = (VIDEO_MAX_SIZE_BYTES / 1024 / 1024).toFixed(0);
      console.log('[Video] File too large:', file.size);
      alert(`视频文件过大 (${sizeMB}MB)\n\n为确保上传成功，请选择小于 ${maxMB}MB 的视频。\n\n建议：\n1. 使用手机相机的"较低质量"设置录制\n2. 控制视频时长在 30 秒以内\n3. 或使用视频压缩工具`);
      // Clear the input
      input.value = '';
      return;
    }

    // Store the video file
    this.currentMediaFiles = [file];
    console.log('[Video] File stored in currentMediaFiles');

    // Show video preview
    const videoPreview = document.getElementById('videoPreview') as HTMLVideoElement;
    const videoPlaceholder = document.getElementById('videoPlaceholder');
    const submitBtn = document.getElementById('submitVideoBtn') as HTMLButtonElement;

    if (videoPreview) {
      console.log('[Video] Setting video preview src');
      videoPreview.src = URL.createObjectURL(file);
      videoPreview.style.display = 'block';
      videoPreview.controls = true;
    }
    if (videoPlaceholder) {
      videoPlaceholder.style.display = 'none';
    }

    // Enable submit button
    if (submitBtn) {
      submitBtn.disabled = false;
      console.log('[Video] Submit button enabled');
    }
  }

  /**
   * Clear selected video and reset UI
   */
  static clearVideoSelection(): void {
    this.currentMediaFiles = [];

    const videoPreview = document.getElementById('videoPreview') as HTMLVideoElement;
    const videoPlaceholder = document.getElementById('videoPlaceholder');
    const videoFileInput = document.getElementById('videoFileInput') as HTMLInputElement;
    const submitBtn = document.getElementById('submitVideoBtn') as HTMLButtonElement;

    if (videoPreview) {
      videoPreview.src = '';
      videoPreview.style.display = 'none';
      videoPreview.controls = false;
    }
    if (videoPlaceholder) {
      videoPlaceholder.style.display = 'block';
    }
    if (videoFileInput) {
      videoFileInput.value = '';
    }
    if (submitBtn) {
      submitBtn.disabled = true;
    }
  }

  /**
   * @deprecated Use handleVideoUpload instead. Kept for backwards compatibility.
   * Toggle video recording with auto-stop at 2MB
   * Monitors size during recording and auto-stops when limit reached
   */
  static async toggleVideoRecording(): Promise<void> {
    // Redirect to file picker for better mobile compatibility
    const videoFileInput = document.getElementById('videoFileInput') as HTMLInputElement;
    if (videoFileInput) {
      videoFileInput.click();
    }
  }

  /**
   * Stop video recording (extracted for auto-stop functionality)
   */
  static stopVideoRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    if (this.videoStream) {
      this.videoStream.getTracks().forEach(track => track.stop());
      this.videoStream = null;
    }

    this.isVideoRecording = false;

    // Update button text
    const toggleBtn = document.getElementById('toggleVideoBtn') as HTMLButtonElement;
    if (toggleBtn) {
      toggleBtn.textContent = '📹 开始录制';
    }

  }

  /**
   * Submit check-in
   * Immediately unblurs map and shows spinner on avatar, then uploads in background
   */
  static async submitCheckIn(): Promise<void> {

    try {
      const currentUser = AuthService.getCurrentUser();
      if (!currentUser) {
        alert('用户未登录');
        return;
      }

      // Get current task from AppModule
      const AppModule = window.AppModule;
      if (!AppModule) {
        return;
      }

      const currentTask = AppModule.currentTask;
      const currentSlotType = AppModule.currentSlotType;

      if (!currentTask || !currentSlotType) {
        alert('未找到当前任务');
        return;
      }

      // Validate media/text before unblurring
      if (currentTask.media_type === 'image' && this.currentMediaFiles.length === 0) {
        alert('请先选择照片');
        return;
      }
      if ((currentTask.media_type === 'voice' || currentTask.media_type === 'video') && this.currentMediaFiles.length === 0) {
        alert('请先录制媒体文件');
        return;
      }
      if (currentTask.media_type === 'text') {
        const textInputEl = document.getElementById('textContent') as HTMLTextAreaElement;
        if (!textInputEl?.value?.trim()) {
          alert('请输入文字内容');
          return;
        }
      }

      // === IMMEDIATE UI FEEDBACK ===
      // 1. Unblur map immediately
      MapModule.setBlur(false);

      // 2. Hide check-in panel with fade-out
      UIModule.hideCheckInPanel();

      // 3. Show spinner on current user's avatar
      MapModule.showAvatarSpinner(currentUser.restaurant_id);

      // === BACKGROUND UPLOAD ===
      // Use dev time if available for cross-day testing (dev mode only)
      const now = TimeControlModule?.isDevMode() ? TimeControlModule.getCurrentTime() : new Date();
      const today = now.toISOString().split('T')[0];
      let mediaUrls: string[] = [];
      let textContent: string | null = null;

      // Handle different media types
      if (currentTask.media_type === 'image') {
        console.log('[CheckIn] Uploading images:', this.currentMediaFiles.length);
        // Upload all images
        for (const file of this.currentMediaFiles) {
          console.log('[CheckIn] Uploading image:', file.name, file.type, `${(file.size/1024).toFixed(1)}KB`);
          const url = await KBDService.uploadMedia(
            file,
            currentUser.restaurant_id,
            currentSlotType,
            currentUser.id
          );
          console.log('[CheckIn] Image uploaded, URL:', url);
          mediaUrls.push(url);
        }
      } else if (currentTask.media_type === 'voice' || currentTask.media_type === 'video') {
        const mediaFile = this.currentMediaFiles[0];
        if (mediaFile) {
          console.log('[CheckIn] Uploading media file:', {
            name: mediaFile.name,
            type: mediaFile.type,
            size: `${(mediaFile.size / 1024 / 1024).toFixed(2)} MB`
          });
          console.log('[CheckIn] Starting KBDService.uploadMedia...');
          const uploadStart = performance.now();
          const url = await KBDService.uploadMedia(
            mediaFile,
            currentUser.restaurant_id,
            currentSlotType,
            currentUser.id
          );
          const uploadTime = performance.now() - uploadStart;
          console.log('[CheckIn] Media uploaded in', uploadTime.toFixed(0), 'ms, URL:', url);
          mediaUrls.push(url);
        }
      } else if (currentTask.media_type === 'text') {
        const textInputEl = document.getElementById('textContent') as HTMLTextAreaElement;
        textContent = textInputEl?.value?.trim() || null;
      }

      // Submit check-in record
      const result = await KBDService.submitCheckIn({
        restaurant_id: currentUser.restaurant_id,
        employee_id: currentUser.id,
        task_id: currentTask.id,
        check_in_date: today,
        slot_type: currentSlotType,
        is_late: false, // TODO: Calculate based on time window
        text_content: textContent,
        media_urls: mediaUrls
      });

      if (!result.success) {
        throw new Error(result.error || 'Check-in failed');
      }


      // === UPLOAD COMPLETE ===
      // Reload restaurants to show updated status and thumbnail FIRST (while spinner still shows)
      // This ensures the thumbnail appears immediately when spinner hides
      if (AppModule.loadRestaurantsAndInitMap) {
        await AppModule.loadRestaurantsAndInitMap();
      }

      // Hide spinner AFTER reload completes so thumbnail appears immediately
      MapModule.hideAvatarSpinner(currentUser.restaurant_id);

      // Reset check-in module
      this.reset();
    } catch (error) {

      // Hide spinner on error
      const currentUser = AuthService.getCurrentUser();
      if (currentUser) {
        MapModule.hideAvatarSpinner(currentUser.restaurant_id);
      }

      // Show panel again on error
      MapModule.setBlur(true);
      UIModule.showCheckInPanel();

      // Provide user-friendly error messages
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      if (errorMessage.includes('timeout') || errorMessage.includes('超时')) {
        alert(`上传超时\n\n可能原因：\n1. 网络连接不稳定\n2. 文件过大（视频建议 < 10MB）\n3. 服务器响应慢\n\n建议：\n• 切换到更稳定的网络\n• 选择较小的视频文件\n• 稍后重试`);
      } else {
        alert(`打卡失败: ${errorMessage}`);
      }
    }
  }

  /**
   * Reset check-in module state
   */
  static reset(): void {

    this.currentMediaFiles = [];
    this.mediaRecorder = null;
    this.audioChunks = [];

    if (this.videoStream) {
      this.videoStream.getTracks().forEach(track => track.stop());
      this.videoStream = null;
    }

    this.isVideoRecording = false;

    // Reset image upload UI
    const imageFileInput = document.getElementById('imageFileInput') as HTMLInputElement;
    const imagePlaceholder = document.getElementById('imagePlaceholder');
    const imagePreviewGrid = document.getElementById('imagePreviewGrid');
    const submitImageBtn = document.getElementById('submitImageBtn') as HTMLButtonElement;

    if (imageFileInput) imageFileInput.value = '';
    if (imagePlaceholder) imagePlaceholder.style.display = 'block';
    if (imagePreviewGrid) {
      imagePreviewGrid.style.display = 'none';
      imagePreviewGrid.innerHTML = '';
    }
    if (submitImageBtn) submitImageBtn.disabled = true;

    // Reset other UI elements
    const audioPlayer = document.getElementById('audioPlayer') as HTMLAudioElement;
    const videoPreview = document.getElementById('videoPreview') as HTMLVideoElement;
    const videoPlaceholder = document.getElementById('videoPlaceholder');
    const videoFileInput = document.getElementById('videoFileInput') as HTMLInputElement;
    const submitVideoBtn = document.getElementById('submitVideoBtn') as HTMLButtonElement;
    const textContent = document.getElementById('textContent') as HTMLTextAreaElement;
    const submitCheckInBtn = document.getElementById('submitCheckInBtn') as HTMLButtonElement;

    if (audioPlayer) audioPlayer.style.display = 'none';
    if (videoPreview) {
      videoPreview.style.display = 'none';
      videoPreview.srcObject = null;
      videoPreview.src = '';
      videoPreview.controls = false;
    }
    if (videoPlaceholder) videoPlaceholder.style.display = 'block';
    if (videoFileInput) videoFileInput.value = '';
    if (submitVideoBtn) submitVideoBtn.disabled = true;
    if (textContent) textContent.value = '';
    if (submitCheckInBtn) {
      submitCheckInBtn.disabled = true;
      submitCheckInBtn.textContent = '✓ 提交打卡';
    }

  }
}

// Export to window for backward compatibility with HTML onclick handlers
if (typeof window !== 'undefined') {
  window.CheckInModule = CheckInModule;
  window.submitCheckIn = () => CheckInModule.submitCheckIn();
  window.startRecording = (e: Event) => CheckInModule.startRecording(e);
  window.stopRecording = (e: Event) => CheckInModule.stopRecording(e);
  window.toggleVideoRecording = () => CheckInModule.toggleVideoRecording();
  window.handleVideoUpload = (e: Event) => CheckInModule.handleVideoUpload(e);
  window.clearVideoSelection = () => CheckInModule.clearVideoSelection();
}
