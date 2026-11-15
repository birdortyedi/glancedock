// Glance Dock's drop-up terminal: a small GTK 3 + VTE program with tabs.
// GNOME Shell can't host a terminal itself, so the bar starts this once and
// talks to it over D-Bus (org.glancedock.Terminal). It outlives shell
// restarts and screen locks, so your shells keep running while it's hidden.
//
// Run by the extension as: gjs -m terminal/main.js
import Gdk from 'gi://Gdk?version=3.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=3.0';
import Pango from 'gi://Pango';
import Vte from 'gi://Vte?version=2.91';

const NAME = 'org.glancedock.Terminal';
const PATH = '/org/glancedock/Terminal';
const IFACE = `<node><interface name="${NAME}">
  <method name="Toggle"><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="u" direction="in"/></method>
  <method name="Show"><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="u" direction="in"/></method>
  <method name="Hide"/>
  <method name="NewTab"><arg type="as" direction="in"/><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="u" direction="in"/></method>
  <method name="Focus"><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="u" direction="in"/></method>
  <method name="Report"/>
  <method name="Quit"/>
  <signal name="TabsChanged"><arg type="as"/><arg type="i"/><arg type="b"/></signal>
</interface></node>`;

// The bar's palette: deep background, soft text, purple accent.
const rgba = s => {
    const c = new Gdk.RGBA();
    c.parse(s);
    return c;
};
// Catppuccin-style colours (its accent is called "mauve") on the bar's
// background, slightly translucent.
const FG = rgba('#e3e1ef');
const BG = rgba('rgba(22, 22, 29, 0.92)');
const PALETTE = ['#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#cba6f7', '#94e2d5', '#bac2de',
    '#585b70', '#f5a3b8', '#b8eab3', '#fbe9c0', '#a4c5fb', '#d7baf9', '#aceadd', '#e3e1ef'].map(rgba);
const ACCENT = '#b9a7ff';
// The bar's look: a rounded dark panel with a hairline border, quiet tabs in
// IBM Plex Sans with a purple underline, and subtle buttons. The selectors
// override the desktop theme (Yaru), which otherwise styles the tabs.
const CSS = `
window { background-color: transparent; }
.glance-term {
    background-color: rgba(22, 22, 29, 0.92);
    border: 1px solid rgba(185, 167, 255, 0.22);
    border-radius: 12px;
    padding: 2px 8px 8px 8px;
}
.glance-term-title {
    font-family: "IBM Plex Mono";
    font-size: 8.5pt;
    color: rgba(185, 167, 255, 0.85);
    padding: 0 10px 0 6px;
}
notebook, notebook > stack { background: none; border: none; }
notebook > header {
    background: none;
    border: none;
    box-shadow: inset 0 -1px rgba(255, 255, 255, 0.07);
    padding: 2px 2px 0 2px;
}
notebook > header > tabs > tab {
    background: none;
    border: none;
    box-shadow: none;
    min-height: 0;
    padding: 6px 10px;
    color: rgba(232, 230, 240, 0.45);
    font-family: "IBM Plex Mono";
    font-size: 9pt;
}
notebook > header > tabs > tab:hover { color: #e8e6f0; }
notebook > header > tabs > tab:checked { color: #e8e6f0; box-shadow: inset 0 -2px #b9a7ff; }
notebook button {
    background: none;
    border: none;
    box-shadow: none;
    min-height: 16px;
    min-width: 16px;
    padding: 2px;
    color: rgba(232, 230, 240, 0.45);
    border-radius: 6px;
}
notebook button:hover { color: #e8e6f0; background-color: rgba(255, 255, 255, 0.08); }
vte-terminal { padding: 10px 12px; }
`;

Gtk.init(null);
const provider = new Gtk.CssProvider();
provider.load_from_data(CSS);
Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
Gtk.Settings.get_default().gtk_application_prefer_dark_theme = true;

const win = new Gtk.Window({title: 'Glance terminal', decorated: false, skip_taskbar_hint: true, skip_pager_hint: true});
win.set_wmclass('glance-terminal', 'Glance terminal');
// A transparent window, so the panel's rounded corners show.
const visual = win.get_screen().get_rgba_visual();
if (visual) {
    win.set_visual(visual);
    win.app_paintable = true;
}
const book = new Gtk.Notebook({scrollable: true, show_border: false});
const plus = Gtk.Button.new_from_icon_name('list-add-symbolic', Gtk.IconSize.MENU);
plus.relief = Gtk.ReliefStyle.NONE;
plus.tooltip_text = 'New terminal (Ctrl+Shift+T)';
plus.connect('clicked', () => newTab([]));
plus.show();
book.set_action_widget(plus, Gtk.PackType.END);
const title = new Gtk.Label({label: '~ term'});
title.get_style_context().add_class('glance-term-title');
title.show();
book.set_action_widget(title, Gtk.PackType.START);
const panel = new Gtk.Box();
panel.get_style_context().add_class('glance-term');
panel.add(book);
book.hexpand = true;
win.add(panel);
// Click anywhere else and it slides away; the shells keep running.
win.connect('focus-out-event', () => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
        if (win.visible && !win.is_active)
            hide();
        return GLib.SOURCE_REMOVE;
    });
    return false;
});
win.connect('delete-event', () => {
    hide();
    return true; // keep the shells running
});

// The extension's settings, read straight from its schema next to this file.
const HERE = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const SCHEMAS = Gio.SettingsSchemaSource.new_from_directory(
    GLib.build_filenamev([HERE, '..', 'schemas']), Gio.SettingsSchemaSource.get_default(), false);
const SETTINGS = new Gio.Settings({settings_schema: SCHEMAS.lookup('org.gnome.shell.extensions.glancedock', false)});
const setting = key => SETTINGS.get_string(key).trim();

// bash with our startup file (your .bashrc, then the conda env); any other
// shell as it is.
function localShell() {
    const shell = GLib.getenv('SHELL') || '/bin/bash';
    return shell.endsWith('bash') ? [shell, '--rcfile', GLib.build_filenamev([HERE, 'bashrc']), '-i'] : [shell];
}

let service = null;
const terms = () => book.get_children();
const current = () => book.get_nth_page(book.get_current_page());

function report() {
    const titles = terms().map(t => t._title);
    service?.emit_signal('TabsChanged', new GLib.Variant('(asib)', [titles, book.get_current_page(), win.visible]));
}

function newTab(argv) {
    const term = new Vte.Terminal({scrollback_lines: 10000, hexpand: true, vexpand: true});
    term.set_font(Pango.FontDescription.from_string('IBM Plex Mono 10.5'));
    term.set_cell_height_scale(1.12);
    term.set_colors(FG, BG, PALETTE);
    term.set_color_cursor(rgba(ACCENT));
    term.set_color_highlight(rgba('rgba(185, 167, 255, 0.35)'));
    term.set_cursor_shape(Vte.CursorShape.IBEAM);
    term.set_cursor_blink_mode(Vte.CursorBlinkMode.ON);
    term.set_bold_is_bright(false);
    term._title = argv.length ? argv.join(' ') : 'Terminal';

    const label = new Gtk.Label({width_chars: 12, max_width_chars: 30, ellipsize: Pango.EllipsizeMode.END});
    term._label = label;
    const close = Gtk.Button.new_from_icon_name('window-close-symbolic', Gtk.IconSize.MENU);
    close.relief = Gtk.ReliefStyle.NONE;
    close.connect('clicked', () => closeTab(term));
    const head = new Gtk.Box({spacing: 6});
    head.add(label);
    head.add(close);
    head.show_all();

    term.connect('window-title-changed', () => {
        term._title = term.get_window_title() || term._title;
        relabel();
        report();
    });
    term.connect('child-exited', () => closeTab(term));

    const shell = argv.length ? argv : localShell();
    const env = GLib.get_environ();
    const condaEnv = setting('terminal-conda-env');
    term.spawn_async(Vte.PtyFlags.DEFAULT, GLib.get_home_dir(), shell,
        condaEnv ? GLib.environ_setenv(env, 'GLANCE_CONDA_ENV', condaEnv, true) : env,
        GLib.SpawnFlags.SEARCH_PATH, null, -1, null, (_t, _pid, error) => {
            if (error)
                term.feed(`Couldn't start ${shell.join(' ')}: ${error.message}\r\n`);
        });

    term.show();
    book.set_current_page(book.append_page(term, head));
    book.set_tab_reorderable(term, true);
    relabel();
    term.grab_focus();
    report();
}

// Tabs read "1  user@host: ~/dir", numbered left to right.
function relabel() {
    terms().forEach((t, i) => {
        t._label.label = `${i + 1}  ${t._title}`;
    });
}

function closeTab(term) {
    if (term.get_parent() !== book)
        return;
    book.remove(term);
    term.destroy();
    relabel();
    if (!terms().length)
        hide();
    report();
}

function show(x, y, w, h, time) {
    win.move(x, y);
    win.resize(w, h);
    if (!terms().length)
        newTab([]);
    win.show_all();
    win.present_with_time(time || Gdk.CURRENT_TIME);
    current()?.grab_focus();
    report();
}

let hiddenAt = 0;
function hide() {
    hiddenAt = Date.now();
    win.hide();
    report();
}

win.connect('key-press-event', (_w, event) => {
    const [, key] = event.get_keyval();
    const [, state] = event.get_state();
    const ctrl = state & Gdk.ModifierType.CONTROL_MASK;
    const shift = state & Gdk.ModifierType.SHIFT_MASK;
    const k = Gdk.keyval_to_lower(key);
    if (ctrl && shift && k === Gdk.KEY_t)
        newTab([]);
    else if (ctrl && shift && k === Gdk.KEY_w)
        closeTab(current());
    else if (ctrl && shift && k === Gdk.KEY_c)
        current()?.copy_clipboard_format(Vte.Format.TEXT);
    else if (ctrl && shift && k === Gdk.KEY_v)
        current()?.paste_clipboard();
    else if (ctrl && key === Gdk.KEY_Page_Up)
        book.prev_page();
    else if (ctrl && key === Gdk.KEY_Page_Down)
        book.next_page();
    else
        return false;
    return true;
});
book.connect('switch-page', () => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
    report();
    return GLib.SOURCE_REMOVE;
}));

const methods = {
    Toggle(x, y, w, h, time) {
        // Clicking the bar button can take focus first and hide us a moment
        // before this call arrives; that click meant "hide", so stay hidden.
        if (!win.visible && Date.now() - hiddenAt < 400)
            return;
        if (win.visible && win.is_active)
            hide();
        else
            show(x, y, w, h, time);
    },
    Show: show,
    Hide: hide,
    NewTab(argv, x, y, w, h, time) {
        show(x, y, w, h, time);
        newTab(argv);
    },
    Focus(index, x, y, w, h, time) {
        book.set_current_page(index);
        show(x, y, w, h, time);
    },
    Report: report,
    Quit() {
        Gtk.main_quit(); // ends every shell in it
    },
};

Gio.bus_own_name(Gio.BusType.SESSION, NAME, Gio.BusNameOwnerFlags.NONE,
    connection => {
        service = Gio.DBusExportedObject.wrapJSObject(IFACE, methods);
        service.export(connection, PATH);
    },
    null,
    () => Gtk.main_quit()); // another copy already runs, or the session ended

Gtk.main();
