<script>
  import { tick } from 'svelte';
  import Icon from "./Icon.svelte";

  let { show = false, onClose } = $props();

  let gitInfo = $state(null);
  let loading = $state(true);
  let error = $state(null);
  let activeTab = $state('status');
  let selectedCommit = $state(null);
  let commitDetails = $state(null);
  let loadingCommit = $state(false);
  let actionMessage = $state(null);
  let actionLoading = $state(false);

  const tabs = [
    { id: 'status', label: 'Status' },
    { id: 'branches', label: 'Branches' },
    { id: 'history', label: 'History' }
  ];

  $effect(() => {
    if (show) {
      loadGitInfo();
    }
  });

  async function loadGitInfo() {
    loading = true;
    error = null;
    actionMessage = null;
    try {
      gitInfo = await window.electronAPI.getGitInfo();
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function selectCommit(commit) {
    if (selectedCommit?.hash === commit.hash) {
      selectedCommit = null;
      commitDetails = null;
      return;
    }
    selectedCommit = commit;
    loadingCommit = true;
    try {
      commitDetails = await window.electronAPI.getCommitDetails(commit.hash);
    } catch (e) {
      console.error('Failed to load commit:', e);
    } finally {
      loadingCommit = false;
    }
  }

  async function switchBranch(branchName) {
    actionLoading = true;
    actionMessage = null;
    try {
      const result = await window.electronAPI.gitSwitchBranch(branchName);
      actionMessage = { type: result.success ? 'success' : 'error', text: result.message };
      if (result.success) {
        await loadGitInfo();
      }
    } catch (e) {
      actionMessage = { type: 'error', text: e.message };
    } finally {
      actionLoading = false;
    }
  }

  async function gitPull() {
    actionLoading = true;
    actionMessage = null;
    try {
      const result = await window.electronAPI.gitPull();
      actionMessage = { type: result.success ? 'success' : 'error', text: result.message };
      if (result.success) {
        await loadGitInfo();
      }
    } catch (e) {
      actionMessage = { type: 'error', text: e.message };
    } finally {
      actionLoading = false;
    }
  }

  async function gitFetch() {
    actionLoading = true;
    actionMessage = null;
    try {
      const result = await window.electronAPI.gitFetch();
      actionMessage = { type: result.success ? 'success' : 'error', text: result.message };
      if (result.success) {
        await loadGitInfo();
      }
    } catch (e) {
      actionMessage = { type: 'error', text: e.message };
    } finally {
      actionLoading = false;
    }
  }

  function getStatusIcon(status) {
    switch (status) {
      case 'M': return '~';
      case 'A': return '+';
      case 'D': return '-';
      case 'R': return '>';
      default: return '?';
    }
  }

  function getStatusColor(status) {
    switch (status) {
      case 'M': return '#f9e2af';
      case 'A': return '#a6e3a1';
      case 'D': return '#f38ba8';
      case 'R': return '#89b4fa';
      default: return '#6c7086';
    }
  }

  function getTotalChanges() {
    if (!gitInfo?.status) return 0;
    return gitInfo.status.staged.length + gitInfo.status.modified.length + gitInfo.status.untracked.length;
  }
</script>

{#if show}
  <div class="modal-backdrop" onclick={onClose}>
    <div class="modal" onclick={(e) => e.stopPropagation()}>
      <div class="modal-header">
        <div class="header-left">
          <span class="modal-icon"><Icon name="GitBranch" size={24} /></span>
          <h2>Git Repository</h2>
        </div>
        <button class="close-btn" onclick={onClose}>×</button>
      </div>

      {#if loading}
        <div class="modal-loading">
          <div class="spinner"></div>
          <p>Loading git info...</p>
        </div>
      {:else if error}
        <div class="modal-error">
          <span class="error-icon"><Icon name="AlertTriangle" size={32} /></span>
          <p>{error}</p>
          <button onclick={loadGitInfo}>Retry</button>
        </div>
      {:else if gitInfo}
        <div class="modal-content">
          <!-- Repo Info Header -->
          <div class="repo-info">
            <div class="repo-main">
              <div class="repo-name">
                <span class="repo-icon"><Icon name="FolderGit" size={16} /></span>
                <a href="https://github.com/{gitInfo.repo}" target="_blank" class="repo-link">
                  {gitInfo.repo || 'Unknown repo'}
                </a>
              </div>
              <div class="branch-badge">
                <span class="branch-icon"><Icon name="GitBranch" size={14} /></span>
                {gitInfo.branch}
                {#if gitInfo.status.ahead > 0 || gitInfo.status.behind > 0}
                  <span class="sync-status">
                    {#if gitInfo.status.ahead > 0}
                      <span class="ahead"><Icon name="ArrowUp" size={12} />{gitInfo.status.ahead}</span>
                    {/if}
                    {#if gitInfo.status.behind > 0}
                      <span class="behind"><Icon name="ArrowDown" size={12} />{gitInfo.status.behind}</span>
                    {/if}
                  </span>
                {/if}
              </div>
            </div>
            <div class="repo-user">
              <span class="user-icon"><Icon name="User" size={14} /></span>
              <span class="user-name">{gitInfo.user || 'Unknown'}</span>
              {#if gitInfo.email}
                <span class="user-email">&lt;{gitInfo.email}&gt;</span>
              {/if}
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="action-bar">
            <button class="action-btn" onclick={gitFetch} disabled={actionLoading}>
              {#if actionLoading}...{:else}<Icon name="RefreshCw" size={14} />{/if} Fetch
            </button>
            <button class="action-btn" onclick={gitPull} disabled={actionLoading}>
              {#if actionLoading}...{:else}<Icon name="Download" size={14} />{/if} Pull
            </button>
            <button class="action-btn" onclick={loadGitInfo} disabled={actionLoading}>
              {#if actionLoading}...{:else}<Icon name="RefreshCw" size={14} />{/if} Refresh
            </button>
          </div>

          {#if actionMessage}
            <div class="action-message" class:success={actionMessage.type === 'success'} class:error={actionMessage.type === 'error'}>
              {actionMessage.text}
            </div>
          {/if}

          <!-- Tabs -->
          <div class="tabs">
            {#each tabs as tab}
              <button
                class="tab"
                class:active={activeTab === tab.id}
                onclick={() => activeTab = tab.id}
              >
                {tab.label}
                {#if tab.id === 'status' && getTotalChanges() > 0}
                  <span class="tab-badge">{getTotalChanges()}</span>
                {/if}
                {#if tab.id === 'branches'}
                  <span class="tab-count">{gitInfo.branches.length}</span>
                {/if}
              </button>
            {/each}
          </div>

          <!-- Tab Content -->
          <div class="tab-content">
            {#if activeTab === 'status'}
              <div class="status-section">
                {#if getTotalChanges() === 0}
                  <div class="clean-state">
                    <span class="clean-icon"><Icon name="Check" size={48} /></span>
                    <p>Working tree clean</p>
                  </div>
                {:else}
                  {#if gitInfo.status.staged.length > 0}
                    <div class="status-group">
                      <h4>Staged Changes ({gitInfo.status.staged.length})</h4>
                      <div class="file-list">
                        {#each gitInfo.status.staged as item}
                          <div class="file-item staged">
                            <span class="file-status" style="color: {getStatusColor(item.status)}">{getStatusIcon(item.status)}</span>
                            <span class="file-name">{item.file}</span>
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/if}

                  {#if gitInfo.status.modified.length > 0}
                    <div class="status-group">
                      <h4>Modified ({gitInfo.status.modified.length})</h4>
                      <div class="file-list">
                        {#each gitInfo.status.modified as item}
                          <div class="file-item modified">
                            <span class="file-status" style="color: {getStatusColor(item.status)}">{getStatusIcon(item.status)}</span>
                            <span class="file-name">{item.file}</span>
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/if}

                  {#if gitInfo.status.untracked.length > 0}
                    <div class="status-group">
                      <h4>Untracked ({gitInfo.status.untracked.length})</h4>
                      <div class="file-list">
                        {#each gitInfo.status.untracked as file}
                          <div class="file-item untracked">
                            <span class="file-status" style="color: #6c7086">?</span>
                            <span class="file-name">{file}</span>
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/if}
                {/if}
              </div>

            {:else if activeTab === 'branches'}
              <div class="branches-section">
                <div class="branch-list">
                  {#each gitInfo.branches.filter(b => !b.isRemote) as branch}
                    <div class="branch-item" class:current={branch.isCurrent}>
                      <div class="branch-info">
                        <span class="branch-name">
                          {#if branch.isCurrent}
                            <span class="current-marker"><Icon name="Circle" size={10} /></span>
                          {/if}
                          {branch.name}
                        </span>
                        {#if branch.track}
                          <span class="branch-track">{branch.track}</span>
                        {/if}
                      </div>
                      {#if !branch.isCurrent}
                        <button
                          class="switch-btn"
                          onclick={() => switchBranch(branch.name)}
                          disabled={actionLoading}
                        >
                          Switch
                        </button>
                      {/if}
                    </div>
                  {/each}
                </div>

                {#if gitInfo.branches.filter(b => b.isRemote).length > 0}
                  <h4 class="remote-header">Remote Branches</h4>
                  <div class="branch-list remote">
                    {#each gitInfo.branches.filter(b => b.isRemote) as branch}
                      <div class="branch-item remote">
                        <span class="branch-name">{branch.name}</span>
                        <button
                          class="switch-btn"
                          onclick={() => switchBranch(branch.name)}
                          disabled={actionLoading}
                        >
                          Checkout
                        </button>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>

            {:else if activeTab === 'history'}
              <div class="history-section">
                <div class="commit-list">
                  {#each gitInfo.recentCommits as commit}
                    <div class="commit-item-wrapper">
                      <button
                        class="commit-item"
                        class:selected={selectedCommit?.hash === commit.hash}
                        onclick={() => selectCommit(commit)}
                      >
                        <div class="commit-main">
                          <span class="commit-hash">{commit.shortHash}</span>
                          <span class="commit-subject">{commit.subject}</span>
                        </div>
                        <div class="commit-meta">
                          <span class="commit-author">{commit.author}</span>
                          <span class="commit-time">{commit.timeAgo}</span>
                        </div>
                      </button>

                      {#if selectedCommit?.hash === commit.hash}
                        <div class="commit-details">
                          {#if loadingCommit}
                            <div class="loading-details">Loading...</div>
                          {:else if commitDetails}
                            <div class="details-content">
                              {#if commitDetails.fullMessage}
                                <div class="commit-message">
                                  <pre>{commitDetails.fullMessage}</pre>
                                </div>
                              {/if}
                              <div class="commit-info-row">
                                <span class="info-label">Author:</span>
                                <span>{commitDetails.author} &lt;{commitDetails.authorEmail}&gt;</span>
                              </div>
                              <div class="commit-info-row">
                                <span class="info-label">Date:</span>
                                <span>{commitDetails.date}</span>
                              </div>
                              {#if commitDetails.files.length > 0}
                                <div class="commit-files">
                                  <h5>Changed Files ({commitDetails.files.length})</h5>
                                  <div class="files-list">
                                    {#each commitDetails.files as file}
                                      <div class="changed-file">
                                        <span class="file-status" style="color: {getStatusColor(file.status)}">{getStatusIcon(file.status)}</span>
                                        <span>{file.file}</span>
                                      </div>
                                    {/each}
                                  </div>
                                </div>
                              {/if}
                              {#if commitDetails.diff}
                                <div class="commit-diff">
                                  <h5>Stats</h5>
                                  <pre>{commitDetails.diff}</pre>
                                </div>
                              {/if}
                            </div>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }

  .modal {
    background: linear-gradient(180deg, #1e1e2e 0%, #181825 100%);
    border-radius: 16px;
    border: 1px solid rgba(69, 71, 90, 0.5);
    width: 700px;
    max-width: 90vw;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 1px solid rgba(69, 71, 90, 0.3);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .modal-icon {
    color: #fab387;
    display: flex;
    align-items: center;
  }

  .modal-header h2 {
    font-size: 18px;
    font-weight: 600;
    color: #cdd6f4;
    margin: 0;
  }

  .close-btn {
    background: rgba(243, 139, 168, 0.1);
    border: none;
    color: #f38ba8;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .close-btn:hover {
    background: rgba(243, 139, 168, 0.2);
  }

  .modal-loading, .modal-error {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px;
    color: #6c7086;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(250, 179, 135, 0.2);
    border-top-color: #fab387;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 16px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .modal-error {
    color: #f38ba8;
  }

  .error-icon {
    margin-bottom: 12px;
    display: flex;
  }

  .modal-error button {
    margin-top: 16px;
    background: rgba(243, 139, 168, 0.2);
    border: 1px solid rgba(243, 139, 168, 0.3);
    color: #f38ba8;
    padding: 8px 20px;
    border-radius: 8px;
    cursor: pointer;
  }

  .modal-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .repo-info {
    padding: 16px 24px;
    background: rgba(49, 50, 68, 0.3);
    border-bottom: 1px solid rgba(69, 71, 90, 0.3);
  }

  .repo-main {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 8px;
  }

  .repo-name {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .repo-icon {
    font-size: 16px;
  }

  .repo-link {
    font-size: 16px;
    font-weight: 600;
    color: #89b4fa;
    text-decoration: none;
  }

  .repo-link:hover {
    text-decoration: underline;
  }

  .branch-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(203, 166, 247, 0.15);
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 13px;
    color: #cba6f7;
  }

  .branch-icon {
    font-size: 14px;
  }

  .sync-status {
    display: flex;
    gap: 6px;
    margin-left: 4px;
  }

  .ahead {
    color: #a6e3a1;
  }

  .behind {
    color: #f9e2af;
  }

  .repo-user {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #6c7086;
  }

  .user-icon {
    font-size: 14px;
  }

  .user-name {
    color: #a6adc8;
  }

  .user-email {
    color: #6c7086;
  }

  .action-bar {
    display: flex;
    gap: 8px;
    padding: 12px 24px;
    border-bottom: 1px solid rgba(69, 71, 90, 0.3);
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: rgba(49, 50, 68, 0.5);
    border: 1px solid rgba(69, 71, 90, 0.3);
    border-radius: 8px;
    color: #cdd6f4;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .action-btn:hover:not(:disabled) {
    background: rgba(69, 71, 90, 0.5);
    border-color: rgba(137, 180, 250, 0.3);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-message {
    padding: 10px 24px;
    font-size: 13px;
  }

  .action-message.success {
    background: rgba(166, 227, 161, 0.1);
    color: #a6e3a1;
  }

  .action-message.error {
    background: rgba(243, 139, 168, 0.1);
    color: #f38ba8;
  }

  .tabs {
    display: flex;
    gap: 4px;
    padding: 12px 24px;
    border-bottom: 1px solid rgba(69, 71, 90, 0.3);
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    background: transparent;
    border: none;
    border-radius: 8px;
    color: #6c7086;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .tab:hover {
    background: rgba(49, 50, 68, 0.5);
    color: #a6adc8;
  }

  .tab.active {
    background: rgba(250, 179, 135, 0.15);
    color: #fab387;
  }

  .tab-badge {
    background: #f38ba8;
    color: #1e1e2e;
    padding: 2px 6px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
  }

  .tab-count {
    background: rgba(0, 0, 0, 0.2);
    padding: 2px 6px;
    border-radius: 10px;
    font-size: 11px;
  }

  .tab-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px 24px;
  }

  .tab-content::-webkit-scrollbar {
    width: 8px;
  }

  .tab-content::-webkit-scrollbar-track {
    background: rgba(49, 50, 68, 0.3);
    border-radius: 4px;
  }

  .tab-content::-webkit-scrollbar-thumb {
    background: rgba(69, 71, 90, 0.8);
    border-radius: 4px;
  }

  .tab-content::-webkit-scrollbar-thumb:hover {
    background: rgba(137, 180, 250, 0.5);
  }

  /* Status Tab */
  .clean-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px;
    color: #a6e3a1;
  }

  .clean-icon {
    font-size: 48px;
    margin-bottom: 12px;
  }

  .status-group {
    margin-bottom: 20px;
  }

  .status-group h4 {
    font-size: 12px;
    font-weight: 600;
    color: #6c7086;
    text-transform: uppercase;
    margin: 0 0 8px 0;
  }

  .file-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .file-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: rgba(49, 50, 68, 0.3);
    border-radius: 6px;
    font-family: "JetBrains Mono", monospace;
    font-size: 12px;
  }

  .file-status {
    font-weight: 700;
    width: 16px;
    text-align: center;
  }

  .file-name {
    color: #cdd6f4;
  }

  /* Branches Tab */
  .branch-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .branch-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: rgba(49, 50, 68, 0.3);
    border-radius: 8px;
    transition: all 0.15s;
  }

  .branch-item.current {
    background: rgba(203, 166, 247, 0.1);
    border: 1px solid rgba(203, 166, 247, 0.2);
  }

  .branch-item.remote {
    opacity: 0.7;
  }

  .branch-info {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .branch-name {
    font-family: "JetBrains Mono", monospace;
    font-size: 13px;
    color: #cdd6f4;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .current-marker {
    color: #a6e3a1;
  }

  .branch-track {
    font-size: 11px;
    color: #6c7086;
  }

  .switch-btn {
    padding: 6px 12px;
    background: rgba(137, 180, 250, 0.1);
    border: 1px solid rgba(137, 180, 250, 0.2);
    border-radius: 6px;
    color: #89b4fa;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .switch-btn:hover:not(:disabled) {
    background: rgba(137, 180, 250, 0.2);
  }

  .switch-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .remote-header {
    font-size: 12px;
    font-weight: 600;
    color: #6c7086;
    text-transform: uppercase;
    margin: 20px 0 8px 0;
  }

  /* History Tab */
  .commit-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .commit-item-wrapper {
    display: flex;
    flex-direction: column;
  }

  .commit-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 14px;
    background: rgba(49, 50, 68, 0.3);
    border: 1px solid transparent;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
    width: 100%;
    color: inherit;
  }

  .commit-item:hover {
    background: rgba(49, 50, 68, 0.5);
  }

  .commit-item.selected {
    background: rgba(250, 179, 135, 0.1);
    border-color: rgba(250, 179, 135, 0.2);
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }

  .commit-main {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .commit-hash {
    font-family: "JetBrains Mono", monospace;
    font-size: 12px;
    color: #fab387;
    background: rgba(250, 179, 135, 0.1);
    padding: 2px 8px;
    border-radius: 4px;
  }

  .commit-subject {
    font-size: 13px;
    color: #cdd6f4;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .commit-meta {
    display: flex;
    gap: 16px;
    font-size: 11px;
    color: #6c7086;
  }

  .commit-details {
    background: rgba(30, 30, 46, 0.8);
    border: 1px solid rgba(250, 179, 135, 0.2);
    border-top: none;
    border-radius: 0 0 8px 8px;
    padding: 16px;
    animation: slideDown 0.2s ease-out;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .loading-details {
    color: #6c7086;
    font-style: italic;
  }

  .commit-message {
    margin-bottom: 12px;
  }

  .commit-message pre {
    margin: 0;
    padding: 12px;
    background: rgba(49, 50, 68, 0.5);
    border-radius: 6px;
    font-family: "JetBrains Mono", monospace;
    font-size: 12px;
    color: #cdd6f4;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .commit-info-row {
    display: flex;
    gap: 8px;
    font-size: 12px;
    margin-bottom: 6px;
  }

  .info-label {
    color: #6c7086;
    min-width: 60px;
  }

  .commit-files {
    margin-top: 12px;
  }

  .commit-files h5, .commit-diff h5 {
    font-size: 11px;
    font-weight: 600;
    color: #6c7086;
    text-transform: uppercase;
    margin: 0 0 8px 0;
  }

  .files-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .changed-file {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    color: #a6adc8;
  }

  .commit-diff {
    margin-top: 12px;
  }

  .commit-diff pre {
    margin: 0;
    padding: 10px;
    background: rgba(49, 50, 68, 0.5);
    border-radius: 6px;
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    color: #a6adc8;
    overflow-x: auto;
  }
</style>
