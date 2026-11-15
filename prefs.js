import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class GlanceDockPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings; // keep alive with the window
        const page = new Adw.PreferencesPage();
        window.add(page);

        const group = (title, description = null) => {
            const g = new Adw.PreferencesGroup({title, description});
            page.add(g);
            return g;
        };
        const toggle = (g, key, title, subtitle = null) => {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            g.add(row);
        };
        const number = (g, key, title, subtitle, lower, upper, step) => {
            const row = new Adw.SpinRow({
                title, subtitle,
                adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 10}),
            });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            g.add(row);
        };

        const widgets = group('Widgets');
        toggle(widgets, 'show-apps', 'Apps', 'Your main apps as icons, plus a +N button for other open apps');
        toggle(widgets, 'show-clock', 'Clock');
        toggle(widgets, 'show-weather', 'Weather');
        toggle(widgets, 'show-todos', 'Todos', 'Next task from ~/.config/glancedock/todos.md');
        toggle(widgets, 'show-notes', 'Notes', 'Quick notes in Inbox.md, opened in Obsidian');
        toggle(widgets, 'show-terminal', 'Terminal', 'A drop-up terminal with tabs; right-click for ssh to your machines');
        toggle(widgets, 'show-folders', 'Folders', 'Home and your Files bookmarks, one click away');
        toggle(widgets, 'show-pomodoro', 'Pomodoro', 'Click to start or pause, right-click to reset');
        toggle(widgets, 'show-media', 'Now playing');
        toggle(widgets, 'show-ai', 'AI usage', 'One card each for Claude Code, Gemini CLI and Antigravity');
        toggle(widgets, 'show-gpu', 'GPUs', 'This computer and your remote machines, from nvidia-smi');
        toggle(widgets, 'show-system', 'CPU, memory and battery');
        toggle(widgets, 'show-network', 'Network speed');
        toggle(widgets, 'show-storage', 'Disk space', 'The fullest drive; hover for all of them');
        toggle(widgets, 'show-audio', 'Volume and microphone', 'Click to mute, scroll to change the volume');
        toggle(widgets, 'show-day', 'Day progress', 'How much of today has passed');
        toggle(widgets, 'show-tailscale', 'Tailscale', 'Connection and online devices; click a device to copy its IP');
        toggle(widgets, 'show-drive', 'Google Drive', 'From Settings → Online Accounts; click to open it in Files');
        toggle(widgets, 'show-bluetooth', 'Bluetooth', 'Turn it on or off and connect paired devices');
        toggle(widgets, 'show-power', 'Power menu', 'Lock, suspend, log out, restart and power off');
        toggle(widgets, 'show-toggles', 'Quick toggles', 'Do Not Disturb, dark style, show desktop');

        const layout = group('Placement');
        toggle(layout, 'hide-top-bar', 'Hide the top bar',
            'GNOME’s top bar only appears in Activities (press Super), where the calendar, Wi-Fi menu and tray icons are');
        toggle(layout, 'auto-hide', 'Hide automatically',
            'Slides away when you’re not using it; touch the bottom edge of the screen to bring it back');
        number(layout, 'dock-height', 'Bar height', 'In pixels', 40, 100, 2);
        number(layout, 'bottom-offset', 'Space below the bar',
            'In pixels. −1 is automatic: above the Ubuntu Dock if you keep it on.', -1, 400, 4);

        const gpus = group('GPUs', 'Remote machines are read over SSH every 30 seconds; they need key login (no password prompt).');
        const hosts = new Adw.EntryRow({
            title: 'Remote machines (SSH host names, separated by commas)',
            text: settings.get_strv('gpu-hosts').join(', '),
            show_apply_button: true,
        });
        hosts.connect('apply', () => settings.set_strv('gpu-hosts',
            hosts.text.split(',').map(h => h.trim()).filter(Boolean)));
        gpus.add(hosts);

        const apps = group('Main apps', 'Desktop file IDs, separated by commas, in the order they appear on the bar.');
        const mainApps = new Adw.EntryRow({
            title: 'Main apps',
            text: settings.get_strv('main-apps').join(', '),
            show_apply_button: true,
        });
        mainApps.connect('apply', () => settings.set_strv('main-apps',
            mainApps.text.split(',').map(a => a.trim()).filter(Boolean)));
        apps.add(mainApps);

        const term = group('Terminal', 'New tabs start in this conda environment, after your usual ~/.bashrc.');
        const condaEnv = new Adw.EntryRow({
            title: 'Conda environment (leave empty for your default)',
            text: settings.get_string('terminal-conda-env'),
            show_apply_button: true,
        });
        condaEnv.connect('apply', () => settings.set_string('terminal-conda-env', condaEnv.text.trim()));
        term.add(condaEnv);

        const notes = group('Notes', 'Point this at a folder Obsidian uses as a vault to see the notes there.');
        const folder = new Adw.EntryRow({
            title: 'Notes folder (leave empty for ~/Notes)',
            text: settings.get_string('notes-folder'),
            show_apply_button: true,
        });
        folder.connect('apply', () => settings.set_string('notes-folder', folder.text.trim()));
        notes.add(folder);

        const weather = group('Weather', 'Forecasts come from Open-Meteo, which needs no account.');
        const city = new Adw.EntryRow({
            title: 'City (leave empty to use your time zone’s city)',
            text: settings.get_string('weather-city'),
            show_apply_button: true,
        });
        city.connect('apply', () => settings.set_string('weather-city', city.text.trim()));
        weather.add(city);
        toggle(weather, 'weather-fahrenheit', 'Fahrenheit');

        const productivity = group('Pomodoro');
        number(productivity, 'pomodoro-work-minutes', 'Focus length', 'Minutes', 1, 180, 5);
        number(productivity, 'pomodoro-break-minutes', 'Break length', 'Minutes', 1, 60, 1);

        const ai = group('AI usage',
            'Claude shows when Claude Code hits a usage limit and when it resets; Anthropic doesn’t expose how full ' +
            'your plan is. Antigravity shows its real quota, remembered after you close it. Gemini CLI is read from ' +
            'its local logs. Add other services as scripts in ~/.config/glancedock/providers/.');
        number(ai, 'gemini-daily-budget', 'Gemini CLI daily budget',
            'Requests per day, reset at midnight Pacific time.', 0, 1e6, 50);
        toggle(ai, 'ai-warnings', 'Warn before running out',
            'Show an alert and a notification when the current pace would use up a limit before it resets');
        number(ai, 'ai-refresh-seconds', 'Refresh every', 'Seconds', 30, 3600, 30);
    }
}
