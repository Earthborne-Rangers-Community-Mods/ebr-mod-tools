/**
 * Reactive store behind the Help modal. Reachable from anywhere in the app.
 */
class HelpDialog {
  isOpen = $state(false);

  open() {
    this.isOpen = true;
  }

  close() {
    this.isOpen = false;
  }
}

export const helpDialog = new HelpDialog();
