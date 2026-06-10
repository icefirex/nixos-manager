<script>
  let { show = false, onClose } = $props();
  let info = $state(null);
  let loading = $state(true);

  $effect(() => {
    if (show) loadInfo();
  });

  async function loadInfo() {
    loading = true;
    try {
      info = await window.electronAPI.getFlakeInfo();
    } catch (e) {
      console.error('Failed to load flake info:', e);
      info = null;
    } finally {
      loading = false;
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') onClose();
  }

  function formatInputList(names) {
    if (!names?.length) return '—';
    if (names.length <= 4) return names.join(', ');
    return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if show}
  <div class="modal-overlay" onclick={onClose}>
    <div class="modal-content" onclick={(e) => e.stopPropagation()}>
      <div class="modal-header">
        <h2>Flake Info</h2>
        <button class="close-btn" onclick={onClose}>x</button>
      </div>

      {#if loading}
        <div class="loading">
          <div class="spinner"></div>
          <p>Loading flake information...</p>
        </div>
      {:else if !info?.flakeDir}
        <div class="loading">
          <p class="no-flake">No flake directory found.</p>
          <p class="hint">
            Set <code>FLAKE_DIR</code> or place <code>flake.nix</code> at<br>
            <code>~/nixos-config</code>, <code>~/.config/nixos</code>, or <code>/etc/nixos</code>
          </p>
        </div>
      {:else}
        <div class="info-grid">

          <!-- Flake -->
          <div class="info-section">
            <h3>Flake</h3>
            <div class="info-row">
              <span class="label">Location</span>
              <span class="value mono small path" title={info.flakeDir}>{info.flakeDir}</span>
            </div>
            {#if info.description}
              <div class="info-row">
                <span class="label">Description</span>
                <span class="value small" title={info.description}>{info.description}</span>
              </div>
            {/if}
            <div class="info-row">
              <span class="label">Inputs</span>
              <span class="value small" title={info.inputNames?.join(', ')}>
                {info.inputCount ?? '—'}{info.inputNames?.length
                  ? ` — ${formatInputList(info.inputNames)}`
                  : ''}
              </span>
            </div>
            <div class="info-row">
              <span class="label">Lock updated</span>
              <span class="value" title={info.lockUpdated}>
                {info.lockUpdatedRelative ?? info.lockUpdated ?? '—'}
              </span>
            </div>
          </div>

          <!-- nixpkgs -->
          <div class="info-section">
            <h3>nixpkgs</h3>
            {#if info.nixpkgsBranch || info.nixpkgsRev}
              <div class="info-row">
                <span class="label">Channel</span>
                <span class="value highlight">{info.nixpkgsBranch ?? 'pinned'}</span>
              </div>
              <div class="info-row">
                <span class="label">Revision</span>
                <span class="value mono dim" title={info.nixpkgsRev}>{info.nixpkgsRev ?? '—'}</span>
              </div>
              <div class="info-row">
                <span class="label">Pinned</span>
                <span class="value">
                  {info.nixpkgsDate ?? '—'}
                  {#if info.nixpkgsRelative}
                    <span class="sub">({info.nixpkgsRelative})</span>
                  {/if}
                </span>
              </div>
            {:else}
              <div class="info-row">
                <span class="value dim small">Not a direct nixpkgs input</span>
              </div>
            {/if}
          </div>

          <!-- Repository -->
          <div class="info-section">
            <h3>Repository</h3>
            <div class="info-row">
              <span class="label">Branch</span>
              <span class="value mono">{info.gitBranch ?? '—'}</span>
            </div>
            <div class="info-row">
              <span class="label">Commit</span>
              <span class="value mono dim">{info.gitRev ?? '—'}</span>
            </div>
            {#if info.gitLastMsg}
              <div class="info-row">
                <span class="label">Last commit</span>
                <span class="value small" title={info.gitLastMsg}>{info.gitLastMsg}</span>
              </div>
            {/if}
            {#if info.gitLastWhen}
              <div class="info-row">
                <span class="label">Age</span>
                <span class="value">{info.gitLastWhen}</span>
              </div>
            {/if}
            <div class="info-row">
              <span class="label">Status</span>
              {#if info.gitDirty > 0}
                <span class="value status-dirty">
                  {info.gitDirty} file{info.gitDirty !== 1 ? 's' : ''} uncommitted
                </span>
              {:else if info.gitRev}
                <span class="value status-clean">clean</span>
              {:else}
                <span class="value dim">—</span>
              {/if}
            </div>
          </div>

          <!-- Build -->
          <div class="info-section">
            <h3>Build</h3>
            <div class="info-row">
              <span class="label">Generation</span>
              <span class="value highlight">#{info.generation ?? '—'}</span>
            </div>
            <div class="info-row">
              <span class="label">Last rebuild</span>
              <span class="value" title={info.lastSwitch}>
                {info.lastSwitchRelative ?? info.lastSwitch ?? '—'}
              </span>
            </div>
            <div class="info-row">
              <span class="label">NixOS</span>
              <span class="value">{info.nixosVersion ?? '—'}</span>
            </div>
            <div class="info-row">
              <span class="label">Nix</span>
              <span class="value">{info.nixVersion ?? '—'}</span>
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
    padding: 60px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    color: #a6adc8;
    text-align: center;
  }

  .no-flake {
    font-size: 15px;
    color: #cdd6f4;
  }

  .hint {
    font-size: 12px;
    color: #6c7086;
    line-height: 1.8;
  }

  .hint code {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 11px;
    background: rgba(49, 50, 68, 0.6);
    padding: 1px 5px;
    border-radius: 4px;
    color: #89b4fa;
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

  /* 2×2 grid matching SystemInfoModal */
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
    align-items: baseline;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 1px solid rgba(49, 50, 68, 0.3);
  }

  .info-row:last-child {
    border-bottom: none;
  }

  .label {
    font-size: 12px;
    color: #6c7086;
    flex-shrink: 0;
  }

  .value {
    font-size: 13px;
    color: #cdd6f4;
    font-weight: 500;
    text-align: right;
    max-width: 65%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value.small {
    font-size: 11px;
  }

  .value.mono {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 12px;
  }

  /* For paths: allow wrapping so nothing is cut off */
  .value.path {
    white-space: normal;
    word-break: break-all;
    line-height: 1.4;
  }

  .value.highlight {
    color: #89b4fa;
    font-weight: 700;
  }

  .value.dim {
    color: #6c7086;
    font-weight: 400;
  }

  .value.status-clean {
    color: #a6e3a1;
    font-weight: 600;
  }

  .value.status-dirty {
    color: #f9e2af;
    font-weight: 500;
  }

  .sub {
    font-size: 11px;
    color: #6c7086;
    font-weight: 400;
    margin-left: 4px;
  }

  @media (max-width: 600px) {
    .info-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
