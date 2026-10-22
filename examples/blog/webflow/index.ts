// Created by `next-webflow typegen`. This file is yours: typegen won't overwrite it (unless --force).
// Types come from ./schema, which typegen regenerates.
import { createWebflow } from "next-webflow";
import { schema, type AuthorsItem, type PostsItem } from "./schema";

export const { getItems, getItemBySlug, getItem } = createWebflow({ schema });
export type * from "./schema";

// Friendlier names for the app.
export type Post = PostsItem;
export type Author = AuthorsItem;
