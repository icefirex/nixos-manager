<script>
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import { onMount } from 'svelte';

  let terminalElement = $state(null);
  let terminal = $state(null);
  let fitAddon = $state(null);

  // Context menu state
  let showContextMenu = $state(false);
  let contextMenuPos = $state({ x: 0, y: 0 });
  let contextMenuEl = $state(null);

  // Create/update portal for context menu
  $effect(() => {
    if (showContextMenu && !contextMenuEl) {
      contextMenuEl = document.createElement('div');
      contextMenuEl.className = 'terminal-context-menu-portal';
      document.body.appendChild(contextMenuEl);
    }

    if (contextMenuEl) {
      if (showContextMenu) {
        contextMenuEl.innerHTML = `
          <div class="context-menu" style="left: ${contextMenuPos.x}px; top: ${contextMenuPos.y}px;">
            <button class="context-item" data-action="copy">Copy</button>
            <button class="context-item" data-action="selectall">Select All</button>
          </div>
        `;
        contextMenuEl.style.display = 'block';

        // Handle clicks on menu items
        const handleMenuClick = (e) => {
          const action = e.target.dataset.action;
          if (action === 'copy') {
            const selection = terminal?.getSelection();
            if (selection) {
              navigator.clipboard.writeText(selection);
            }
          } else if (action === 'selectall') {
            terminal?.selectAll();
          }
          showContextMenu = false;
        };
        contextMenuEl.addEventListener('click', handleMenuClick);

        return () => {
          contextMenuEl.removeEventListener('click', handleMenuClick);
        };
      } else {
        contextMenuEl.style.display = 'none';
      }
    }
  });

  // Cleanup portal on unmount
  onMount(() => {
    return () => {
      if (contextMenuEl) {
        contextMenuEl.remove();
      }
    };
  });

  onMount(() => {
    terminal = new Terminal({
      theme: {
        background: '#11111b',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        cursorAccent: '#11111b',
        selectionBackground: 'rgba(137, 180, 250, 0.3)',
        selectionForeground: '#cdd6f4',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#cba6f7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#cba6f7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8',
      },
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 11,
      lineHeight: 1.3,
      cursorBlink: false,
      cursorStyle: 'bar',
      scrollback: 5000,
      convertEol: true,
      allowProposedApi: true,
      rightClickSelectsWord: true,
    });

    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalElement);

    // Fit after a small delay to ensure container is sized
    setTimeout(() => fitAddon.fit(), 50);

    // Handle keyboard shortcuts for copy
    terminal.attachCustomKeyEventHandler((event) => {
      // Ctrl+Shift+C to copy
      if (event.ctrlKey && event.shiftKey && event.key === 'C') {
        const selection = terminal.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection);
        }
        return false;
      }
      // Ctrl+C without shift - let it pass through (for SIGINT if needed)
      if (event.ctrlKey && !event.shiftKey && event.key === 'c') {
        const selection = terminal.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection);
          return false;
        }
      }
      return true;
    });

    // Right-click context menu
    terminalElement.addEventListener('contextmenu', (e) => {
      e.preventDefault();

      // Calculate position and clamp to viewport bounds
      const menuWidth = 120;
      const menuHeight = 80;
      const padding = 8;

      let x = e.clientX;
      let y = e.clientY;

      // Clamp X to stay within viewport
      if (x + menuWidth + padding > window.innerWidth) {
        x = window.innerWidth - menuWidth - padding;
      }

      // Clamp Y to stay within viewport (account for menu appearing above if near bottom)
      if (y + menuHeight + padding > window.innerHeight) {
        y = e.clientY - menuHeight - padding;
      }

      // Ensure minimum bounds
      x = Math.max(padding, x);
      y = Math.max(padding, y);

      contextMenuPos = { x, y };
      showContextMenu = true;
    });

    // Close context menu on click elsewhere — store handler for cleanup
    const handleDocumentClick = () => { showContextMenu = false; };
    document.addEventListener('click', handleDocumentClick);

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddon) {
        setTimeout(() => fitAddon.fit(), 10);
      }
    });
    resizeObserver.observe(terminalElement);

    return () => {
      document.removeEventListener('click', handleDocumentClick);
      resizeObserver.disconnect();
      terminal?.dispose();
    };
  });

  export function clear() {
    if (terminal) {
      terminal.clear();
      terminal.reset();
    }
  }

  export function write(data) {
    terminal?.write(data);
  }
</script>

<div class="terminal-wrapper">
  <div class="terminal-container" bind:this={terminalElement}></div>
</div>

<style>
  .terminal-wrapper {
    width: 100%;
    height: 100%;
    position: relative;
    border-radius: 8px;
    overflow: hidden;
  }

  .terminal-container {
    width: 100%;
    height: 100%;
    background: #11111b;
    overflow: hidden;
  }

  /* Context menu styles - global because menu is portaled to body */
  :global(.terminal-context-menu-portal) {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 10000;
    pointer-events: none;
  }

  :global(.terminal-context-menu-portal .context-menu) {
    position: fixed;
    background: rgba(30, 30, 46, 0.98);
    border: 1px solid rgba(69, 71, 90, 0.8);
    border-radius: 8px;
    padding: 4px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(8px);
    min-width: 100px;
    pointer-events: auto;
  }

  :global(.terminal-context-menu-portal .context-item) {
    display: block;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    color: #cdd6f4;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    border-radius: 4px;
    transition: background 0.15s;
  }

  :global(.terminal-context-menu-portal .context-item:hover) {
    background: rgba(137, 180, 250, 0.2);
  }

  .terminal-container :global(.xterm) {
    padding: 12px;
    height: 100%;
  }

  .terminal-container :global(.xterm-screen) {
    padding: 0;
  }

  .terminal-container :global(.xterm-viewport) {
    overflow-y: auto !important;
    background: #11111b !important;
  }

  /* Custom scrollbar - thin and subtle */
  .terminal-container :global(.xterm-viewport::-webkit-scrollbar) {
    width: 8px;
    background: transparent;
  }

  .terminal-container :global(.xterm-viewport::-webkit-scrollbar-track) {
    background: rgba(17, 17, 27, 0.5);
    border-radius: 4px;
    margin: 4px 0;
  }

  .terminal-container :global(.xterm-viewport::-webkit-scrollbar-thumb) {
    background: linear-gradient(180deg, rgba(137, 180, 250, 0.4), rgba(137, 180, 250, 0.2));
    border-radius: 4px;
    border: 2px solid transparent;
    background-clip: padding-box;
  }

  .terminal-container :global(.xterm-viewport::-webkit-scrollbar-thumb:hover) {
    background: linear-gradient(180deg, rgba(137, 180, 250, 0.6), rgba(137, 180, 250, 0.4));
    background-clip: padding-box;
  }

  /* Hide the scrollbar corner */
  .terminal-container :global(.xterm-viewport::-webkit-scrollbar-corner) {
    background: transparent;
  }

  /* Hide decoration bar if present */
  .terminal-container :global(.xterm-decoration-container) {
    display: none !important;
  }
</style>
