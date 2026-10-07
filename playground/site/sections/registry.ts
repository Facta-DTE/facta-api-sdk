// The sections of the playground (docs/playground.md §5). Later batches
// fill a section by replacing the component of its folder; routes and the
// navigation come from this list, so nothing else changes.

import type { ComponentType } from "react";
import { Home } from "./home/index.tsx";
import { Screens } from "./screens/index.tsx";
import { Headless } from "./headless/index.tsx";
import { ServerRecipes } from "./server/index.tsx";
import { Referencia } from "./referencia/index.tsx";
import { Registro } from "./registro/index.tsx";

export interface Section {
  path: string;
  label: string;
  Component: ComponentType;
}

export const SECTIONS: Section[] = [
  { path: "/", label: "Inicio", Component: Home },
  { path: "/pantallas", label: "Pantallas React", Component: Screens },
  { path: "/implementacion", label: "Mi propia implementación", Component: Headless },
  { path: "/servidor", label: "Solo servidor", Component: ServerRecipes },
  { path: "/referencia", label: "Referencia del SDK", Component: Referencia },
  { path: "/registro", label: "Registro", Component: Registro },
];
