<script>
  import {
    Home, Compass, Package, SlidersHorizontal, History, Hammer,
    ArrowDownToLine, Users, Trash2, ScrollText, Settings,
    Zap, Rocket, FlaskConical, CheckCircle,
    Film, Music, Video, Code, GraduationCap, Gamepad2, Palette,
    Globe, FileText, Microscope, Monitor, Wrench,
    Search, Loader, RefreshCw, AlertTriangle, Bug, Play,
    ChevronDown, ChevronRight,
    GitBranch, FolderGit, ArrowUp, ArrowDown, User, Download, Check, Circle,
    Snowflake
  } from 'lucide-svelte';

  const icons = {
    Home, Compass, Package, SlidersHorizontal, History, Hammer,
    ArrowDownToLine, Users, Trash2, ScrollText, Settings,
    Zap, Rocket, FlaskConical, CheckCircle,
    Film, Music, Video, Code, GraduationCap, Gamepad2, Palette,
    Globe, FileText, Microscope, Monitor, Wrench,
    Search, Loader, RefreshCw, AlertTriangle, Bug, Play,
    ChevronDown, ChevronRight,
    GitBranch, FolderGit, ArrowUp, ArrowDown, User, Download, Check, Circle,
    Snowflake
  };

  let { name, size = 20, ...rest } = $props();
</script>

{#if icons[name]}
  {@const Component = icons[name]}
  <Component {size} {...rest} />
{/if}
