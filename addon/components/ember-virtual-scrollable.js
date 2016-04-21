/* global Scroller */
import Ember from 'ember';
import { translate } from 'ember-collection/utils/translate';

// Certain android devices are firing a touchCancel immediately after
// touchStart, which prevents scrolling entirely.
let needsTouchCancelHack = false;
const userAgent = window.navigator.userAgent;
if (userAgent && userAgent.indexOf && userAgent.indexOf('Android 4.4') !== -1) {
  needsTouchCancelHack = true;
}

var fieldRegex = /input|textarea|select/i,
  hasTouch = ('ontouchstart' in window) || window.DocumentTouch && document instanceof window.DocumentTouch,
  handleStart, handleMove, handleEnd, handleCancel,
  startEvent, moveEvent, endEvent, cancelEvent;
if (hasTouch) {
  startEvent = 'touchstart';
  handleStart = function (e) {
    var touch = e.touches[0],
      target = touch && touch.target;
    // avoid e.preventDefault() on fields
    if (target && fieldRegex.test(target.tagName)) {
      return;
    }
    bindWindow(this.scrollerEventHandlers);
    this.doTouchStart(e.touches, e.timeStamp);
  };
  moveEvent = 'touchmove';
  handleMove = function (e) {
    if (needsTouchCancelHack) {
      e.preventDefault();
    }
    this.doTouchMove(e.touches, e.timeStamp);
  };
  endEvent = 'touchend';
  handleEnd = function (e) {
    unbindWindow(this.scrollerEventHandlers);
    this.doTouchEnd(e.timeStamp);
  };
  cancelEvent = 'touchcancel';
  handleCancel = function (e) {
    unbindWindow(this.scrollerEventHandlers);
    this.doTouchEnd(e.timeStamp);
  };
} else {
  startEvent = 'mousedown';
  handleStart = function (e) {
    if (e.which !== 1) {
      return;
    }
    var target = e.target;
    // avoid e.preventDefault() on fields
    if (target && fieldRegex.test(target.tagName)) {
      return;
    }
    bindWindow(this.scrollerEventHandlers);
    this.doTouchStart([e], e.timeStamp);
    e.preventDefault();
  };
  moveEvent = 'mousemove';
  handleMove = function (e) {
    this.doTouchMove([e], e.timeStamp);
  };
  endEvent = 'mouseup';
  handleEnd = function (e) {
    unbindWindow(this.scrollerEventHandlers);
    this.doTouchEnd(e.timeStamp);
  };
  cancelEvent = 'mouseout';
  handleCancel = function (e) {
    if (e.relatedTarget) {
      return;
    }
    unbindWindow(this.scrollerEventHandlers);
    this.doTouchEnd(e.timeStamp);
  };
}

function handleWheel(e) {
  this.mouseWheel(e);
  e.preventDefault();
}

function bindElement(el, handlers) {
  el.addEventListener(startEvent, handlers.start, false);
  el.addEventListener('mousewheel', handlers.wheel, false);
}

function unbindElement(el, handlers) {
  el.removeEventListener(startEvent, handlers.start, false);
  el.removeEventListener('mousewheel', handlers.wheel, false);
}

function bindWindow(handlers) {
  window.addEventListener(moveEvent, handlers.move, true);
  window.addEventListener(endEvent, handlers.end, true);
  window.addEventListener(cancelEvent, handlers.cancel, true);
}

function unbindWindow(handlers) {
  window.removeEventListener(moveEvent, handlers.move, true);
  window.removeEventListener(endEvent, handlers.end, true);
  window.removeEventListener(cancelEvent, handlers.cancel, true);
}

export default Ember.Component.extend({
  init() {
    this._clientWidth = undefined;
    this._clientHeight = undefined;
    this._contentSize = undefined;
    this._appliedContentSize = {};
    this._needsContentSizeUpdate = false;
    this._scrollLeft = 0;
    this._scrollTop = 0;
    this._appliedScrollLeft = undefined;
    this._appliedScrollTop = undefined;
    this._animationFrame = undefined;
    this._isTouching = false;
    this.scroller = undefined;
    this.scrollerEventHandlers = {
      start: handleStart.bind(this),
      move: handleMove.bind(this),
      end: handleEnd.bind(this),
      cancel: handleCancel.bind(this),
      wheel: handleWheel.bind(this)
    };
    this._super();
  },
  didReceiveAttrs() {
    this._contentSize = this.getAttr('content-size');
    this._scrollLeft = this.getAttr('scroll-left');
    this._scrollTop = this.getAttr('scroll-top');
  },
  didInsertElement() {
    this.contentElement = this.element.firstElementChild;
    this.setupScroller();
    this.applyStyle();
    this.applyContentSize();
    this.syncScrollFromAttr();
    this.startSizeCheck();
    this.bindScrollerEvents();
  },
  willRender() {
    this.willRenderContentSize();
  },
  didUpdate() {
    this.applyContentSize();
  },
  setupScroller: function(){
    this.scroller = new Scroller((left, top/*, zoom*/) => {
      let scroller = this.scroller;
      Ember.run.join(this, this.onScrollChange, left|0, top|0, {
        decelerationVelocityX: scroller.__decelerationVelocityX,
        decelerationVelocityY: scroller.__decelerationVelocityY
      });
    }, {
      scrollingX: false,
      scrollingComplete: () => {
        this.sendAction('scrollingComplete');
      }
    });
  },
  onScrollChange(scrollLeft, scrollTop, params) {
    if (this._appliedScrollTop !== scrollTop || this._appliedScrollLeft !== scrollLeft) {
      this._appliedScrollLeft = scrollLeft;
      this._appliedScrollTop = scrollTop;
      if (this.contentElement) {
        translate(this.contentElement, scrollLeft, -1 * scrollTop);
      }
      if (this._initialSizeCheckCompleted && (this._scrollLeft !== scrollLeft || this._scrollTop !== scrollTop)) {
        this.sendAction('scrollChange', scrollLeft, scrollTop, params);
      }
    }
  },
  syncScrollFromAttr() {
    if (!this._initialSizeCheckCompleted) {
      return; // no sense in trying scroll until we are sized properly
    }
    if (this._appliedScrollLeft !== this._scrollLeft || this._appliedScrollTop !== this._scrollTop) {
      this.scroller.scrollTo(this._scrollLeft, this._scrollTop);
    }
  },
  updateScrollerDimensions() {
    if (this._clientWidth && this._clientHeight) {
      this.scroller.setDimensions(this._clientWidth, this._clientHeight, this._contentSize.width, this._contentSize.height);
    }
  },
  didRender(){
    this.syncScrollFromAttr();
  },
  willDestroyElement() {
    this.contentElement = undefined;
    this.unbindScrollerEvents();
    this.cancelSizeCheck();
  },
  applyStyle() {
    // hack to force render buffer so outside doesn't repaint on scroll
    let element = this.element;
    if (!element) {
      return;
    }
    translate(element, 0, 0);

    element.style.overflow = 'hidden';
    element.style.position = 'absolute';
    element.style.left = 0;
    element.style.top = 0;
    element.style.bottom = 0;
    element.style.right = 0;
    element.style.boxSizing = 'border-box';

    this.contentElement.style.position = 'relative';
  },
  willRenderContentSize(){
    if (this._appliedContentSize &&
        (this._appliedContentSize.width !== this._contentSize.width ||
        this._appliedContentSize.height !== this._contentSize.height)
      ) {
      this._appliedContentSize = this._contentSize;
      this._needsContentSizeUpdate = true;
      this.updateScrollerDimensions();
    }
  },
  applyContentSize() {
    if (this._needsContentSizeUpdate) {
      this.contentElement.style.width = this._contentSize.width + 'px';
      this.contentElement.style.height = this._contentSize.height + 'px';
      this._needsContentSizeUpdate = false;
    }
  },
  startSizeCheck() {
    const component = this;
    function step() {
      component.sizeCheck();
      nextStep();
    }
    function nextStep() {
      component._animationFrame = requestAnimationFrame(step);
    }

    // Before we check the size for the first time, we capture the intended scroll position
    // and apply it after we determine and apply the size. The reason we need to do this
    // is that attempting to apply the scroll position before the scroller has size results
    // in a scroll position of [0,0].
    let initialScrollLeft = this._scrollLeft;
    let initialScrollTop = this._scrollTop;
    component.sizeCheck();
    this._initialSizeCheckCompleted = true;
    if (initialScrollLeft || initialScrollTop) {
      this.scroller.scrollTo(initialScrollLeft, initialScrollTop);
    }
    nextStep();
  },
  cancelSizeCheck() {
    if (this._animationFrame) {
      cancelAnimationFrame(this._animationFrame);
      this._animationFrame = undefined;
    }
  },
  sizeCheck() {
    let element = this.element;
    let clientWidth = element.offsetWidth;
    let clientHeight = element.offsetHeight;
    if (clientWidth !== this._clientWidth || clientHeight !== this._clientHeight) {
      this._clientWidth = clientWidth;
      this._clientHeight = clientHeight;
      Ember.run.join(() => {
        this.updateScrollerDimensions();
        this.sendClientSizeChange(clientWidth, clientHeight);
      });
    }
  },
  sendClientSizeChange(width, height) {
    this.sendAction('clientSizeChange', width, height);
  },
  bindScrollerEvents: function() {
    bindElement(this.element, this.scrollerEventHandlers);
  },
  unbindScrollerEvents: function() {
    unbindElement(this.element, this.scrollerEventHandlers);
    unbindWindow(this.scrollerEventHandlers);
  },

  doTouchStart: function(touches, timeStamp) {
    this._isTouching = true;
    this.scroller.doTouchStart(touches, timeStamp);
    this.sendAction('touchingChange', this._isTouching);
  },
  doTouchMove: function(touches, timeStamp) {
    this.scroller.doTouchMove(touches, timeStamp);
  },
  doTouchEnd: function(timeStamp) {
    this._isTouching = false;
    this.scroller.doTouchEnd(timeStamp);
    this.sendAction('touchingChange', this._isTouching);
  },

  mouseWheel: function(e){
    let inverted = e.webkitDirectionInvertedFromDevice;
    let delta = e.wheelDeltaY * (inverted ? 0.8 : -0.8);
    let candidatePosition = this.scroller.__scrollTop + delta;

    if ((candidatePosition >= 0) && (candidatePosition <= this.scroller.__maxScrollTop)) {
      this.scroller.scrollBy(0, delta, true);
      e.stopPropagation();
    }

    return false;
  }
});
