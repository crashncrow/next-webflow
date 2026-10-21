// Created by `next-webflow typegen`. This file is yours: typegen won't overwrite it (unless --force).
// Types come from ./schema, which typegen regenerates.
import { createWebflow } from "next-webflow";
import { schema } from "./schema";

export const { getItems, getItemBySlug, getItem } = createWebflow({ schema });
export type * from "./schema";
