// Version: 5.1 - Fixed text input element ID bug (textInput -> textContent)
// Check-in Module - Media recording and submission
// Handles: Image upload, voice recording, video recording, check-in submission

import { KBDService } from '@services/kbd.service';
import { AuthService } from '@services/auth.service';

console.log('[CHECKIN] Module loaded');

export class CheckInModule {
  // State
  static currentMediaFile: File | null = null;
  static mediaRecorder: MediaRecorder | null = null;
  static audioChunks: Blob[] = [];
  static videoStream: MediaStream | null = null;
  static isVideoRecording: boolean = false;

  /**
   * Initialize check-in module event listeners
   */
  static initialize(): void {
    console.log('[CHECKIN] Initializing check-in module');

    // Image upload handler
    const imageInput = document.getElementById('imageInput') as HTMLInputElement;
    if (imageInput) {
      imageInput.addEventListener('change', (e) => this.handleImageUpload(e));
    }

    // Text input handler
    const textInput = document.getElementById('textInput') as HTMLTextAreaElement;
    if (textInput) {
      textInput.addEventListener('input', () => {
        const submitBtn = document.getElementById('submitCheckInBtn') as HTMLButtonElement;
        if (submitBtn) {
          submitBtn.disabled = !textInput.value.trim();
        }
      });
    }

    console.log('[CHECKIN] Check-in module initialized');
  }

  /**
   * Handle image file upload
   */
  static handleImageUpload(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];

    if (file) {
      console.log('[CHECKIN] Image selected:', file.name);
      this.currentMediaFile = file;

      // Show preview
      const preview = document.getElementById('imagePreview') as HTMLImageElement;
      const submitBtn = document.getElementById('submitCheckInBtn') as HTMLButtonElement;

      if (preview) {
        const reader = new FileReader();
        reader.onload = (e) => {
          preview.src = e.target?.result as string;
          preview.style.display = 'block';
        };
        reader.readAsDataURL(file);
      }

      if (submitBtn) {
        submitBtn.disabled = false;
      }
    }
  }

  /**
   * Start voice recording
   */
  static async startRecording(event: Event): Promise<void> {
    event.preventDefault();
    console.log('[CHECKIN] Starting voice recording');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (e) => {
        this.audioChunks.push(e.data);
      };

      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        this.currentMediaFile = new File([audioBlob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });

        // Show audio player
        const audioPlayer = document.getElementById('audioPlayer') as HTMLAudioElement;
        if (audioPlayer) {
          audioPlayer.src = URL.createObjectURL(audioBlob);
          audioPlayer.style.display = 'block';
        }

        // Enable submit button
        const submitBtn = document.getElementById('submitCheckInBtn') as HTMLButtonElement;
        if (submitBtn) {
          submitBtn.disabled = false;
        }

        console.log('[CHECKIN] Voice recording saved');
      };

      this.mediaRecorder.start();

      // Update UI buttons
      const startBtn = document.getElementById('startRecordBtn') as HTMLButtonElement;
      const stopBtn = document.getElementById('stopRecordBtn') as HTMLButtonElement;

      if (startBtn) startBtn.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'inline-block';

      console.log('[CHECKIN] Voice recording started');
    } catch (error) {
      console.error('[CHECKIN] Error starting voice recording:', error);
      alert('无法访问麦克风，请检查权限设置');
    }
  }

  /**
   * Stop voice recording
   */
  static stopRecording(event: Event): void {
    event.preventDefault();
    console.log('[CHECKIN] Stopping voice recording');

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();

      // Stop all audio tracks
      this.mediaRecorder.stream.getTracks().forEach(track => track.stop());

      // Update UI buttons
      const startBtn = document.getElementById('startRecordBtn') as HTMLButtonElement;
      const stopBtn = document.getElementById('stopRecordBtn') as HTMLButtonElement;

      if (startBtn) startBtn.style.display = 'inline-block';
      if (stopBtn) stopBtn.style.display = 'none';

      console.log('[CHECKIN] Voice recording stopped');
    }
  }

  /**
   * Toggle video recording
   */
  static async toggleVideoRecording(): Promise<void> {
    console.log('[CHECKIN] Toggling video recording');

    if (!this.isVideoRecording) {
      // Start recording
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: true
        });

        this.videoStream = stream;
        const videoPreview = document.getElementById('videoPreview') as HTMLVideoElement;

        if (videoPreview) {
          videoPreview.srcObject = stream;
          videoPreview.style.display = 'block';
          videoPreview.play();
        }

        // Start MediaRecorder
        const chunks: Blob[] = [];
        this.mediaRecorder = new MediaRecorder(stream);

        this.mediaRecorder.ondataavailable = (e) => {
          chunks.push(e.data);
        };

        this.mediaRecorder.onstop = () => {
          const videoBlob = new Blob(chunks, { type: 'video/webm' });
          this.currentMediaFile = new File([videoBlob], `video_${Date.now()}.webm`, { type: 'video/webm' });

          // Show video player
          if (videoPreview) {
            videoPreview.srcObject = null;
            videoPreview.src = URL.createObjectURL(videoBlob);
            videoPreview.controls = true;
          }

          // Enable submit button
          const submitBtn = document.getElementById('submitCheckInBtn') as HTMLButtonElement;
          if (submitBtn) {
            submitBtn.disabled = false;
          }

          console.log('[CHECKIN] Video recording saved');
        };

        this.mediaRecorder.start();
        this.isVideoRecording = true;

        // Update button text
        const toggleBtn = document.getElementById('toggleVideoBtn') as HTMLButtonElement;
        if (toggleBtn) {
          toggleBtn.textContent = '⏹️ 停止录制';
        }

        console.log('[CHECKIN] Video recording started');
      } catch (error) {
        console.error('[CHECKIN] Error starting video recording:', error);
        alert('无法访问摄像头，请检查权限设置');
      }
    } else {
      // Stop recording
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

      console.log('[CHECKIN] Video recording stopped');
    }
  }

  /**
   * Submit check-in
   */
  static async submitCheckIn(): Promise<void> {
    console.log('[CHECKIN] Submitting check-in');

    try {
      const currentUser = AuthService.getCurrentUser();
      if (!currentUser) {
        alert('用户未登录');
        return;
      }

      // Get current task from AppModule
      const AppModule = window.AppModule;
      if (!AppModule) {
        console.error('[CHECKIN] AppModule not found');
        return;
      }

      const currentTask = AppModule.currentTask;
      const currentSlotType = AppModule.currentSlotType;

      if (!currentTask || !currentSlotType) {
        alert('未找到当前任务');
        return;
      }

      const today = new Date().toISOString().split('T')[0];
      let mediaUrl: string | null = null;
      let textContent: string | null = null;

      // Disable submit button
      const submitBtn = document.getElementById('submitCheckInBtn') as HTMLButtonElement;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '提交中...';
      }

      // Handle different media types
      if (currentTask.media_type === 'image' || currentTask.media_type === 'voice' || currentTask.media_type === 'video') {
        if (!this.currentMediaFile) {
          alert('请先上传媒体文件');
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = '✓ 提交打卡';
          }
          return;
        }

        console.log('[CHECKIN] Uploading media file...');
        mediaUrl = await KBDService.uploadMedia(
          this.currentMediaFile,
          currentUser.restaurant_id,
          currentSlotType,
          currentUser.id
        );
        console.log('[CHECKIN] Media uploaded:', mediaUrl);
      } else if (currentTask.media_type === 'text') {
        const textInputEl = document.getElementById('textContent') as HTMLTextAreaElement;
        textContent = textInputEl?.value?.trim() || null;

        if (!textContent) {
          alert('请输入文字内容');
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = '✓ 提交打卡';
          }
          return;
        }
      }

      // Submit check-in record
      console.log('[CHECKIN] Submitting check-in record...');
      const result = await KBDService.submitCheckIn({
        restaurant_id: currentUser.restaurant_id,
        employee_id: currentUser.id,
        task_id: currentTask.id,
        check_in_date: today,
        slot_type: currentSlotType,
        is_late: false, // TODO: Calculate based on time window
        text_content: textContent,
        media_urls: mediaUrl ? [mediaUrl] : []
      });

      if (!result.success) {
        throw new Error(result.error || 'Check-in failed');
      }

      console.log('[CHECKIN] Check-in submitted successfully');

      // Trigger completion animation
      const UIModule = window.UIModule;
      if (UIModule) {
        await UIModule.performCheckInAnimation(mediaUrl, async () => {
          // Reload restaurants after check-in
          if (AppModule.loadRestaurantsAndInitMap) {
            await AppModule.loadRestaurantsAndInitMap();
          }
        });
      }

      // Reset check-in module
      this.reset();
    } catch (error) {
      console.error('[CHECKIN] Check-in error:', error);
      alert(`打卡失败: ${error instanceof Error ? error.message : 'Unknown error'}`);

      // Re-enable submit button
      const submitBtn = document.getElementById('submitCheckInBtn') as HTMLButtonElement;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '✓ 提交打卡';
      }
    }
  }

  /**
   * Reset check-in module state
   */
  static reset(): void {
    console.log('[CHECKIN] Resetting check-in module');

    this.currentMediaFile = null;
    this.mediaRecorder = null;
    this.audioChunks = [];

    if (this.videoStream) {
      this.videoStream.getTracks().forEach(track => track.stop());
      this.videoStream = null;
    }

    this.isVideoRecording = false;

    // Reset UI elements
    const imageInput = document.getElementById('imageInput') as HTMLInputElement;
    const imagePreview = document.getElementById('imagePreview') as HTMLImageElement;
    const audioPlayer = document.getElementById('audioPlayer') as HTMLAudioElement;
    const videoPreview = document.getElementById('videoPreview') as HTMLVideoElement;
    const textInput = document.getElementById('textInput') as HTMLTextAreaElement;
    const submitBtn = document.getElementById('submitCheckInBtn') as HTMLButtonElement;

    if (imageInput) imageInput.value = '';
    if (imagePreview) imagePreview.style.display = 'none';
    if (audioPlayer) audioPlayer.style.display = 'none';
    if (videoPreview) {
      videoPreview.style.display = 'none';
      videoPreview.srcObject = null;
      videoPreview.src = '';
      videoPreview.controls = false;
    }
    if (textInput) textInput.value = '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '✓ 提交打卡';
    }

    console.log('[CHECKIN] Check-in module reset complete');
  }
}

// Export to window for backward compatibility with HTML onclick handlers
if (typeof window !== 'undefined') {
  window.CheckInModule = CheckInModule;
  window.submitCheckIn = () => CheckInModule.submitCheckIn();
  window.startRecording = (e: Event) => CheckInModule.startRecording(e);
  window.stopRecording = (e: Event) => CheckInModule.stopRecording(e);
  window.toggleVideoRecording = () => CheckInModule.toggleVideoRecording();
  console.log('[CHECKIN] Module exported to window');
}
