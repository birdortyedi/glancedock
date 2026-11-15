import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {iconButton} from '../lib/popup.js';
import {addTooltip} from '../lib/tooltip.js';
import {Widget} from '../lib/widget.js';

// One click opens GNOME's screenshot tool: an area, a window or the screen,
// as a picture or a recording.
export class ScreenshotWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this.actor = iconButton('screenshot-app-symbolic');
        this.actor.connect('clicked', () => Main.screenshotUI.open()
            .catch(e => console.error('[Glance Dock] screenshot:', e)));
        addTooltip(this.actor, () => 'Screenshot or recording (also Print Screen)');
    }
}
