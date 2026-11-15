import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Shows the text returned by `getText()` above `actor` while the pointer is on it.
// The label is created once and only shown/hidden on hover (like GNOME's dash
// labels): adding/destroying uiGroup children from a hover notify can land in
// the middle of a uiGroup layout pass and allocate a freed actor.
export function addTooltip(actor, getText) {
    actor.reactive = true;
    actor.track_hover = true;
    let tip = null;

    actor.connect('notify::hover', () => {
        const text = actor.hover ? getText() : null;
        if (!text) {
            tip?.hide();
            return;
        }
        if (!tip) {
            tip = new St.Label({style_class: 'glance-tooltip'});
            Main.uiGroup.add_child(tip);
        }
        tip.text = text;
        tip.show();
        const [x, y] = actor.get_transformed_position();
        const [width] = actor.get_transformed_size();
        const [, tipWidth] = tip.get_preferred_width(-1);
        const [, tipHeight] = tip.get_preferred_height(tipWidth);
        const monitor = Main.layoutManager.findMonitorForActor(actor) ?? Main.layoutManager.primaryMonitor;
        const left = Math.max(monitor.x + 8,
            Math.min(x + width / 2 - tipWidth / 2, monitor.x + monitor.width - tipWidth - 8));
        tip.set_position(Math.round(left), Math.round(y - tipHeight - 12));
    });
    actor.connect('destroy', () => {
        tip?.destroy();
        tip = null;
    });
}
