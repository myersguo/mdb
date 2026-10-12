import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});
