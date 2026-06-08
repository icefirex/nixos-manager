<script>
  let { show = false, onClose } = $props();
  let info = $state(null);
  let loading = $state(true);

  $effect(() => {
    if (show) {
      loadInfo();
    }
  });

  async function loadInfo() {
    loading = true;
    try {
      info = await window.electronAPI.getDetailedSystemInfo();
    } catch (e) {
      console.error('Failed to load system info:', e);
    } finally {
      loading = false;
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if show}
  <div class="modal-overlay" onclick={onClose}>
    <div class="modal-content" onclick={(e) => e.stopPropagation()}>
      <div class="modal-header">
        <h2>System Information</h2>
        <button class="close-btn" onclick={onClose}>x</button>
      </div>

      {#if loading}
        <div class="loading">
          <div class="spinner"></div>
          <p>Loading system information...</p>
        </div>
      {:else if info}
        <div class="info-grid">
          <!-- System Section -->
          <div class="info-section">
            <h3>System</h3>
            <div class="info-row">
              <span class="label">OS</span>
              <span class="value">{info.osName}</span>
            </div>
            <div class="info-row">
              <span class="label">Version</span>
              <span class="value">{info.nixosVersion}</span>
            </div>
            <div class="info-row">
              <span class="label">Kernel</span>
              <span class="value">{info.kernel}</span>
            </div>
            <div class="info-row">
              <span class="label">Architecture</span>
              <span class="value">{info.arch}</span>
            </div>
            <div class="info-row">
              <span class="label">Uptime</span>
              <span class="value">{info.uptime}</span>
            </div>
          </div>

          <!-- NixOS Section -->
          <div class="info-section">
            <h3>NixOS</h3>
            <div class="info-row">
              <span class="label">Generation</span>
              <span class="value highlight">#{info.generation}</span>
            </div>
            <div class="info-row">
              <span class="label">Specialization</span>
              <span class="value">{info.specialization}</span>
            </div>
            <div class="info-row">
              <span class="label">Last Build</span>
              <span class="value">{info.buildTime}</span>
            </div>
            <div class="info-row">
              <span class="label">Store Paths</span>
              <span class="value">{info.nixStorePaths}</span>
            </div>
            <div class="info-row">
              <span class="label">Packages</span>
              <span class="value">{info.packageCount} binaries</span>
            </div>
          </div>

          <!-- Hardware Section -->
          <div class="info-section">
            <h3>Hardware</h3>
            <div class="info-row">
              <span class="label">CPU</span>
              <span class="value small">{info.cpu.model}</span>
            </div>
            <div class="info-row">
              <span class="label">Cores</span>
              <span class="value">{info.cpu.cores}</span>
            </div>
            <div class="info-row">
              <span class="label">Hostname</span>
              <span class="value">{info.hostname}</span>
            </div>
            <div class="info-row">
              <span class="label">User</span>
              <span class="value">{info.username}</span>
            </div>
          </div>

          <!-- Resources Section -->
          <div class="info-section">
            <h3>Resources</h3>
            <div class="resource-item">
              <div class="resource-header">
                <span class="label">Memory</span>
                <span class="value">{info.memory.used} / {info.memory.total}</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill memory" style="width: {info.memory.percentage}%"></div>
              </div>
              <span class="percentage">{info.memory.percentage}%</span>
            </div>
            <div class="resource-item">
              <div class="resource-header">
                <span class="label">Disk</span>
                <span class="value">{info.disk.used} / {info.disk.total}</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill disk" style="width: {info.disk.percentage}%"></div>
              </div>
              <span class="percentage">{info.disk.percentage}%</span>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }

  .modal-content {
    background: #1e1e2e;
    border: 1px solid rgba(137, 180, 250, 0.3);
    border-radius: 20px;
    padding: 0;
    width: 90%;
    max-width: 700px;
    max-height: 85vh;
    overflow: hidden;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 1px solid rgba(49, 50, 68, 0.5);
    background: rgba(24, 24, 37, 0.9);
  }

  .modal-header h2 {
    font-size: 18px;
    font-weight: 600;
    color: #cdd6f4;
    margin: 0;
  }

  .close-btn {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: none;
    background: rgba(49, 50, 68, 0.8);
    color: #a6adc8;
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .close-btn:hover {
    background: rgba(243, 139, 168, 0.2);
    color: #f38ba8;
  }

  .loading {
    padding: 60px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    color: #a6adc8;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(137, 180, 250, 0.2);
    border-top-color: #89b4fa;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: rgba(49, 50, 68, 0.3);
    padding: 1px;
  }

  .info-section {
    background: #1e1e2e;
    padding: 20px;
  }

  .info-section h3 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #6c7086;
    margin-bottom: 16px;
    font-weight: 600;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid rgba(49, 50, 68, 0.3);
  }

  .info-row:last-child {
    border-bottom: none;
  }

  .label {
    font-size: 12px;
    color: #6c7086;
  }

  .value {
    font-size: 13px;
    color: #cdd6f4;
    font-weight: 500;
    text-align: right;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value.small {
    font-size: 11px;
  }

  .value.highlight {
    color: #89b4fa;
    font-weight: 700;
  }

  .resource-item {
    margin-bottom: 16px;
  }

  .resource-item:last-child {
    margin-bottom: 0;
  }

  .resource-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .progress-bar {
    height: 8px;
    background: rgba(49, 50, 68, 0.8);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 4px;
  }

  .progress-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.5s ease;
  }

  .progress-fill.memory {
    background: linear-gradient(90deg, #89b4fa, #b4befe);
  }

  .progress-fill.disk {
    background: linear-gradient(90deg, #a6e3a1, #94e2d5);
  }

  .percentage {
    font-size: 11px;
    color: #6c7086;
  }

  @media (max-width: 600px) {
    .info-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
