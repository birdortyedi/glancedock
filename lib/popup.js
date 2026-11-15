import St from 'gi://St';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// A menu that opens above `button` when it's clicked, and goes with it.
// `fill` (optional) rebuilds the items just before it opens; GNOME won't
// open an empty menu, so filling after opening would never happen.
export function addPopup(button, fill = null) {
    const menu = new PopupMenu.PopupMenu(button, 0.5, St.Side.BOTTOM);
    menu.actor.add_style_class_name('glance-todo-menu');
    Main.uiGroup.add_child(menu.actor);
    menu.actor.hide();
    new PopupMenu.PopupMenuManager(button).addMenu(menu);
    button.connect('clicked', () => {
        if (!menu.isOpen)
            fill?.();
        menu.toggle(BoxPointer.PopupAnimation.FULL);
    });
    button.connect('destroy', () => menu.destroy());
    return menu;
}

// A round icon button for the bar.
export function iconButton(iconName) {
    return new St.Button({
        style_class: 'glance-icon-button',
        child: new St.Icon({icon_name: iconName}),
        can_focus: true,
    });
}

// Empties a menu or menu section that may be open. GNOME's top-level menu
// keeps pointing at the active (hovered or clicked) item even after the item
// is destroyed, and closing the menu then fails and leaves its input grab in
// place, so every button stops responding. Deactivating first avoids that.
export function clearMenu(menu) {
    for (const child of menu.box.get_children()) {
        if ('active' in child)
            child.active = false;
    }
    menu.removeAll();
}
