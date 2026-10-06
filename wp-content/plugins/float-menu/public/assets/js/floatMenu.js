/**
 * FloatMenu
 * A JavaScript class for creating customizable side menus.
 *
 * @version 7.1
 * @license MIT License
 * @author Dmytro Lobov
 * @url https://wow-estore.com/item/float-menu-pro/
 */

'use strict';

class FloatMenu {

    static ATTR = `data-float-menu`;

    static initialize() {
        window.floatMenus = {};
        document.querySelectorAll(`[${FloatMenu.ATTR}]`).forEach((floatmenu) => {
            const instance = new FloatMenu(floatmenu);
            const match = floatmenu.className.match(/float-menu-(\d+)/);
            if (match && match[1]) {
                const key = match[1];
                window.floatMenus[key] = instance;
            }
        });
    }

    constructor(floatmenuElement, options = {}) {
        if (!(floatmenuElement instanceof HTMLElement)) {
            return;
        }

        const defaultConfig = {
            'position': ['left', 'center'],
        };

        this.element = floatmenuElement;
        this.config = Object.assign({}, defaultConfig, this.#parseConfig(), options);
        if (this.config === null) return;

        this.items = floatmenuElement.querySelectorAll(`.fm-item`);
        this.links = floatmenuElement.querySelectorAll(`.fm-link`);
        this.labels = floatmenuElement.querySelectorAll(`.fm-label`);

        if (this.items.length === 0) {
            return;
        }

        const ITEM_PADDING = 15;

        this.itemWidth = this.items[0].offsetWidth + ITEM_PADDING;

        if (this.config?.remove) {
            this.element.removeAttribute(FloatMenu.ATTR);
        }

        this.init();

    }

    init() {

        this.screen();
        window.addEventListener('resize', this.screen.bind(this));
        this.mobileStyle();
        window.addEventListener('resize', this.mobileStyle.bind(this));
        this.labelDisabele();
        this.mobileClick();
        this.position();
        this.appearance();
        this.setLinkProperties();
        this.setSubMenu();
        this.extraText();
        this.visibleMenu();
        this.closePopup();
    }


    appearance() {
        if (!this.config?.appearance) {
            return;
        }

        if (this.config?.appearance?.shape) {
            this.element.classList.add(this.config?.appearance?.shape);
        }

        if (this.config?.appearance?.sideSpace) {
            this.element.classList.add('-side-space');
        }

        if (this.config?.appearance?.buttonSpace) {
            this.element.classList.add('-button-space');
        }

        if (this.config?.appearance?.labelConnected) {
            this.element.classList.add('-label-connect');
        }

        if (this.config?.appearance?.subSpace) {
            this.element.classList.add('-sub-space');
        }

    }

    labelDisabele() {


        if (!this.config?.label?.off) {
            return false;
        }
        this.links.forEach((label) => {
            label.classList.add('-label-hidden');
        });
    }

    screen() {
        if (!this.config?.screen) {
            return;
        }

        const {small, large} = this.config.screen;
        const viewportWidth = window.innerWidth;

        const hideMenu = () => {
            this.element.classList.add('fm-hidden');
        };

        const showMenu = () => {
            this.element.classList.remove('fm-hidden');
        };

        if (typeof small !== 'undefined' && viewportWidth <= small) {
            hideMenu();
            return;
        }

        if (typeof large !== 'undefined' && viewportWidth >= large) {
            hideMenu();
            return;
        }

        if (typeof small === 'undefined' || typeof large === 'undefined' ||
            (viewportWidth > small && viewportWidth < large)) {
            showMenu();
        }

    }

    closePopup() {
        const popups = this.element.querySelectorAll(`.fm-window`);
        if (popups.length === 0) {
            return;
        }

        popups.forEach((popup) => {
            const close = popup.querySelector(`.fm-close`);
            if (close) {
                close.addEventListener('click', () => {
                    popup.close();
                });
            }

            popup.addEventListener('click', closeOnBackDropClick);

            function closeOnBackDropClick({currentTarget, target}) {
                const dialogElement = currentTarget;
                const isClickedOnBackDrop = target === dialogElement;
                if (isClickedOnBackDrop) {
                    dialogElement.close();
                }
            }
        });
    }

    extraText() {
        const textBox = this.element.querySelectorAll(`.fm-extra-text`);
        if (textBox.length === 0) {
            return;
        }

        textBox.forEach(text => {
            const space = parseFloat(this.config?.label?.space) || 0;
            text.style.setProperty('--text_margin', space);
            const item = text.closest('.fm-item');
            const link = item.querySelector('.fm-link');

            item.addEventListener('mouseenter', () => {
                link.classList.toggle('-active');
            });
            item.addEventListener('mouseleave', () => {
                link.classList.remove('-active');
            });

        });

    }

    visibleMenu() {

        if (
            (!this.config.visible || this.config.visible.every(v => v === 'show' || v === '0')) &&
            (!this.config.time || this.config.time.every(t => t === 'show' || t === '0'))
        ) {
            this.element.classList.add('fm-ready');
            return;
        }

        let isReady = false;

        const showMenu = () => {
            if (!isReady) {
                this.element.classList.add('fm-ready');
                isReady = true;
            }
        };

        const hideMenu = () => {
            if (isReady) {
                this.element.classList.remove('fm-ready');
                isReady = false;
            }
        };

        if (this.config.time) {
            const time = this.config.time || ['show', '0'];
            const [timeAction, timeValue] = time;
            const timeThreshold = Number(timeValue);

            if (timeAction === 'show' && timeThreshold > 0) {
                setTimeout(showMenu, timeThreshold * 1000);
            }

            if (timeAction === 'hide' && timeThreshold > 0) {
                showMenu();
                setTimeout(hideMenu, timeThreshold * 1000);
            }
        }

        if (this.config.visible) {

            const visible = this.config.visible || ['show', '0'];
            const [visibleAction, visibleValue] = visible;
            const visibleThreshold = Number(visibleValue);

            if (visibleAction === 'hide') {
                showMenu();
            }

            window.addEventListener('scroll', () => {
                const scrollTop = window.scrollY || document.documentElement.scrollTop;

                if (visibleAction === 'show') {
                    if (scrollTop >= visibleThreshold) {
                        showMenu();

                    } else {
                        hideMenu();
                    }
                }

                if (visibleAction === 'hide') {
                    if (scrollTop > visibleThreshold) {
                        hideMenu();
                    } else {
                        showMenu();
                    }
                }

            });
        }

    }

    mobileStyle() {

        if (!this.config?.mobile) {
            return;
        }

        const screenWidth = window.innerWidth;
        const screen = parseInt(this.config?.mobile[0]) || 0;
        const iconSize = parseInt(this.config?.mobile[1]) || 24;
        const labelSize = parseInt(this.config?.mobile[2]) || 15;
        const boxSize = parseInt(this.config?.mobile[3]) || 0;
        const textSize = parseInt(this.config?.mobile[4]) || 12;

        if (screenWidth < screen) {
            this.element.style.setProperty('--fm-icon-size', iconSize);
            this.element.style.setProperty('--fm-label-size', labelSize);
            this.element.style.setProperty('--fm-icon-text', textSize);
            if(boxSize !== 0 ) {
                this.element.style.setProperty('--fm-icon-box', boxSize);
            }
        }

    }

    mobileClick() {
        if (!this._isMobile()) {
            return;
        }

        if (!this.config?.mobileRules) {
            return;
        }

        this.links.forEach((link) => {
            let timer;
            link.addEventListener('click', (event) => {

                if (!link.classList.contains('-active')) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    this.links.forEach((otherLink) => {
                        otherLink.classList.remove('-active');
                    });

                    link.classList.add('-active');
                    clearTimeout(timer);

                    setTimeout(() => {
                        link.classList.remove('-active');
                        link.blur();
                    }, 3000);
                }
            });
        });

        document.addEventListener('click', (event) => {
            if (!this.element.contains(event.target)) {
                this.links.forEach((link) => {
                    const item = link.closest('.fm-item');
                    link.classList.remove('-active');
                    item.classList.remove('-active');
                });
            }
        });

    }

    position() {
        let side = this.config?.position[0] || 'left';
        let align = this.config?.position[1] || 'center';

        this.element.classList.add(`-${side}`);
        this.element.classList.add(`-${align}`);

        const style = this.element.getBoundingClientRect();
        let offsetSide = 0;
        let offsetTop = 0;

        if (this.config?.offset) {
            offsetSide = parseInt(this.config?.offset[0]);
            offsetTop = parseInt(this.config?.offset[1]);
        }

        if (offsetSide !== 0) {
            this.element.style.setProperty('--fm-offset', `${offsetSide}px`);
        }



        if (align === 'top') {
            let top = style.top + offsetTop;
            this.element.style.top = `${top}px`;
        }
        else if (align === 'center') {
            let top = style.top + offsetTop;
            const menuHeight = this.element.offsetHeight;
            top = top - menuHeight / 2;
            this.element.style.top = `${top}px`;
        }
        else if(align === 'bottom') {
            let bottom = offsetTop * (-1);
            this.element.style.bottom = `${bottom}px`;
        }

    }

    setLinkProperties() {
        const space = parseFloat(this.config?.label?.space) || 0;
        const labelEffect = this.config?.label?.effect || 'none';

        this.links.forEach((link) => {
            const label = link.querySelector('.fm-label');
            let labelWidth = label.offsetWidth + space;
            const iconWidth = link.offsetWidth;
            const width = iconWidth + labelWidth;
            if (link.classList.contains('fm-hold-open')) {
                labelWidth = labelWidth - iconWidth + 12;
            }
            link.style.setProperty('--_width', labelWidth);
            link.classList.add(`-${labelEffect}`);
        });
    }

    setSubMenu() {
        if (!this.config?.sub) {
            return;
        }

        const hasSub = this.element.querySelectorAll('.fm-has-sub');
        if (hasSub.length === 0) {
            return;
        }

        const position = this.config?.sub?.position || 'under';
        const effect = this.config?.sub?.effect || 'none';
        const open = this.config?.sub?.open || 'click';

        let activeSub = null;

        hasSub.forEach((sub) => {
            sub.classList.add(`fm-sub-${position}`);
            sub.classList.add(`-sub-${effect}`);

            const previousElements = [];
            let sibling = sub.previousElementSibling;

            while (sibling) {
                if (sibling.classList.contains('fm-item')) {
                    previousElements.push(sibling);
                }
                sibling = sibling.previousElementSibling;
            }

            this.setSubProperties(sub, effect, position);

            const link = sub.querySelector('.fm-link');

            if (open === 'click' || this._isMobile()) {

                link.addEventListener('click', (event) => {
                    event.preventDefault();
                })

                sub.addEventListener('click', (event) => {
                    event.stopPropagation();

                    if (activeSub && activeSub !== sub) {
                        this.closeSubMenu(activeSub, position);
                    }

                    if (activeSub) {
                        if (
                            activeSub.contains(event.target) &&
                            (event.target.matches('.fm-sub') || event.target.closest('.fm-link')) &&
                            (link && !link.contains(event.target))
                        ) {
                            return;
                        }
                    }

                    sub.classList.toggle(`-active`);
                    // link.classList.toggle(`-active`);
                    activeSub = sub.classList.contains(`-active`) ? sub : null;

                    if (position === 'circular') {
                        link.classList.toggle(`-label-hidden`);
                        if (previousElements.length > 0) {
                            previousElements.forEach((item) => {
                                item.classList.toggle(`-hidden`);
                            });
                        }
                    }
                });
            } else {
                sub.addEventListener('mouseenter', () => {
                    const link = sub.querySelector('.fm-link');
                    sub.classList.add(`-active`);
                    if (!link.classList.contains('-active')) {
                        link.classList.add(`-active`);
                    }

                    if (position === 'circular') {
                        link.classList.toggle(`-label-hidden`);
                        if (previousElements.length > 0) {
                            previousElements.forEach((item) => {
                                item.classList.toggle(`-hidden`);
                            });
                        }
                    }
                });

                sub.addEventListener('mouseleave', () => {
                    this.closeSubMenu(sub, position);
                });

            }
        });

        document.addEventListener('click', (event) => {
            if (activeSub && !activeSub.contains(event.target)) {
                this.closeSubMenu(activeSub, position);
                activeSub = null;
            }
        });
    };

    closeSubMenu(sub, position) {
        const link = sub.querySelector('.fm-link');
        sub.classList.remove(`-active`);

        if (!link.classList.contains('fm-hold-open')) {
            link.classList.remove(`-active`);
        } else {
            link.classList.add(`-active`);
        }

        if (position === 'circular') {
            link.classList.toggle(`-label-hidden`);
            const previousElements = this.element.querySelectorAll('.fm-item.-hidden');

            if (previousElements.length > 0) {
                previousElements.forEach((item) => {
                    item.classList.remove(`-hidden`);
                });
            }
        }
    }

    setSubProperties(sub, effect, position) {
        const subMenu = sub.querySelector(`.fm-sub`);
        const height = subMenu.offsetHeight;

        if (position !== 'circular') {
            sub.style.setProperty('--_offset', height);
        }

        const items = subMenu.querySelectorAll(`.fm-item`);
        const speed = parseInt(this.config?.sub?.speed) || 0;
        const count = items.length;
        const step = speed / count;
        let itemWidth = items[0].offsetWidth;

        if ((effect === 'linear-fade') && items.length > 0) {
            items.forEach((item, index) => {
                const delay = index * step;
                const closeDelay = (count - 1 - index) * step;
                const duration = step;
                item.style.setProperty('--_delay', `${delay}`);
                item.style.setProperty('--_close_delay', `${closeDelay}`);
            });
        }

        if ((effect === 'linear-slide') && items.length > 0) {
            items.forEach((item, index) => {
                const top = ((index + 1) * itemWidth * -1);
                item.style.setProperty('--_top', `${top}px`);
            });
        }

        if (position === 'circular') {
            this.subMenuCircular(subMenu, items, sub);
        }

    }

    subMenuCircular(subMenu, items, sub) {
        const itemWidth = this.itemWidth;
        const angleIncrement = this.calculateAngleIncrement(items.length);
        let radius = this.calculateOptimalRadius(itemWidth, angleIncrement);
        const minRadius = itemWidth * 1.5;

        if (radius < minRadius) {
            radius = minRadius;
        }

        sub.style.setProperty('--_offset', radius);
        sub.style.setProperty('--_box', radius);

        this.setMenuProperties(items, angleIncrement, radius, subMenu, itemWidth);
    }

    setMenuProperties(items, angleIncrement, radius, subMenu, itemWidth) {
        const offset = radius + 2;
        if (subMenu.classList.contains(`-active`)) {
            subMenu.style.setProperty('margin-bottom', `${offset}px`);
        } else {
            subMenu.style.setProperty('margin-bottom', `unset`);
        }

        const speed = parseInt(this.config?.sub?.speed) || 0;
        const count = items.length;
        const step = speed / count;

        items.forEach((item, index) => {
            const reverseIndex = items.length - 1 - index;
            const angle = this.determineAngleForMenu(subMenu, angleIncrement, index, reverseIndex);
            this.styleMenuItem(item, subMenu, radius, angle, index, step);
        });
    }

    determineAngleForMenu(menu, angleIncrement, index, reverseIndex) {

        const position = this.config?.position[0] || 'left';

        if (position === 'left') {
            return angleIncrement * index - Math.PI / 2;
        } else if (position === 'right') {
            return angleIncrement * reverseIndex + Math.PI / 2;
        }

    }

    styleMenuItem(item, menu, radius, angle, index, step) {
        const delay = index * step;

        const x = radius * Math.cos(angle);
        const y = radius * Math.sin(angle);
        item.style.setProperty('--x', `${x}px`);
        item.style.setProperty('--y', `${y}px`);
        item.style.setProperty('--_delay', `${delay}`);

    }

    calculateAngleIncrement(itemCount) {
        const baseAngle = Math.PI;
        return baseAngle / (itemCount - 1);
    }

    calculateOptimalRadius(itemWidth, angleIncrement) {
        return (itemWidth / 2) / Math.sin(angleIncrement / 2);
    }

    #parseConfig() {
        const options = this.element.getAttribute(`${FloatMenu.ATTR}`);
        if (!options || options.trim() === '') {
            return {};
        }

        try {
            const parsedOptions = JSON.parse(options);
            return parsedOptions;
        } catch (error) {
            return {};
        }

    }

    _isMobile() {
        return /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
            window.innerWidth <= 768 ||
            'ontouchstart' in window ||
            navigator.maxTouchPoints > 0;
    }

    _isObjEmpty(obj) {
        return obj && typeof obj === 'object' && Object.keys(obj).length === 0;
    }

    _showConfig() {
        console.log(this.config);
    }

}

document.addEventListener('DOMContentLoaded', function () {
    FloatMenu.initialize();
});
