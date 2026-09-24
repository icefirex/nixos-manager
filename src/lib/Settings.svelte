<script lang="ts">
  import { onMount } from 'svelte';
  import {
    THEME_IDS,
    THEME_LABELS,
    getTheme,
    applyTheme,
    watchSystemTheme,
    type ThemeId,
  } from './themes.ts';

  let theme = $state<ThemeId>('mocha');
  let saved = $state(false);

  onMount(() => {
    theme = getTheme();
    const unwatch = watchSystemTheme();
    return unwatch;
  });

  function handleThemeChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value as ThemeId;
    theme = value;
    applyTheme(value);
    saved = true;
    setTimeout(() => (saved = false), 1500);
  }
</script>

<div class="settings-page">
  <h1>Settings</h1>

  <section class="settings-card">
    <h2>Appearance</h2>

    <div class="setting-row">
      <div class="setting-info">
        <label for="theme-select">Theme</label>
        <p class="setting-description">
          Applies to the whole application, including the terminal. "Match system" follows
          your desktop's light/dark preference.
        </p>
      </div>
      <select id="theme-select" value={theme} onchange={handleThemeChange}>
        {#each THEME_IDS as id (id)}
          <option value={id}>{THEME_LABELS[id]}</option>
        {/each}
      </select>
    </div>

    {#if saved}
      <p class="saved-hint">Theme saved</p>
    {/if}
  </section>
</div>

<style>
  .settings-page {
    padding: 24px 32px;
    max-width: 760px;
  }

  h1 {
    font-size: 22px;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 20px;
  }

  .settings-card {
    background: rgba(var(--mantle-rgb), 0.6);
    border: 1px solid rgba(var(--surface0-rgb), 0.5);
    border-radius: 12px;
    padding: 20px 24px;
  }

  h2 {
    font-size: 14px;
    font-weight: 600;
    color: var(--overlay0);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 16px;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
  }

  .setting-info label {
    display: block;
    font-size: 14px;
    font-weight: 500;
    color: var(--text);
    margin-bottom: 4px;
  }

  .setting-description {
    font-size: 12px;
    color: var(--subtext0);
    max-width: 420px;
    line-height: 1.5;
  }

  select {
    background: var(--base);
    color: var(--text);
    border: 1px solid rgba(var(--surface1-rgb), 0.8);
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    cursor: pointer;
    min-width: 220px;
    transition: border-color 0.2s ease;
  }

  select:focus {
    outline: none;
    border-color: var(--blue);
    box-shadow: 0 0 0 2px rgba(var(--blue-rgb), 0.25);
  }

  .saved-hint {
    margin-top: 12px;
    font-size: 12px;
    color: var(--green);
  }
</style>
