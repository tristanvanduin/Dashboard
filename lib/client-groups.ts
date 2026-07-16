/**
 * Client groups: organize clients into collapsible folders in the sidebar.
 * Persisted in Supabase.
 */

import { supabase } from "./supabase";

export interface ClientGroup {
  id: string;
  name: string;
  sort_order: number;
}

export interface GroupWithMembers extends ClientGroup {
  clientIds: string[];
}

// In-memory cache
let groupsCache: GroupWithMembers[] | null = null;

/**
 * Load all groups with their member client IDs from Supabase.
 */
export async function loadClientGroups(): Promise<GroupWithMembers[]> {
  if (!supabase) return [];

  const [{ data: groups }, { data: members }] = await Promise.all([
    supabase.from("client_groups").select("*").order("sort_order"),
    supabase.from("client_group_members").select("*"),
  ]);

  const membersByGroup = new Map<string, string[]>();
  for (const m of members ?? []) {
    const list = membersByGroup.get(m.group_id) ?? [];
    list.push(m.client_id);
    membersByGroup.set(m.group_id, list);
  }

  groupsCache = (groups ?? []).map((g) => ({
    ...g,
    clientIds: membersByGroup.get(g.id) ?? [],
  }));

  return groupsCache;
}

/** Get cached groups (call loadClientGroups first) */
export function getClientGroups(): GroupWithMembers[] {
  return groupsCache ?? [];
}

/** Create a new group */
export async function createGroup(name: string): Promise<ClientGroup | null> {
  if (!supabase) return null;
  const maxOrder = (groupsCache ?? []).reduce((max, g) => Math.max(max, g.sort_order), 0);
  const { data } = await supabase
    .from("client_groups")
    .insert({ name, sort_order: maxOrder + 1 })
    .select()
    .single();
  if (data) {
    groupsCache = null; // invalidate
  }
  return data;
}

/** Rename a group */
export async function renameGroup(groupId: string, name: string): Promise<void> {
  if (!supabase) return;
  await supabase.from("client_groups").update({ name }).eq("id", groupId);
  groupsCache = null;
}

/** Delete a group (members are cascade-deleted) */
export async function deleteGroup(groupId: string): Promise<void> {
  if (!supabase) return;
  await supabase.from("client_groups").delete().eq("id", groupId);
  groupsCache = null;
}

/** Add a client to a group */
export async function addClientToGroup(clientId: string, groupId: string): Promise<void> {
  if (!supabase) return;
  await supabase.from("client_group_members").upsert({ client_id: clientId, group_id: groupId });
  groupsCache = null;
}

/** Remove a client from a group */
export async function removeClientFromGroup(clientId: string, groupId: string): Promise<void> {
  if (!supabase) return;
  await supabase
    .from("client_group_members")
    .delete()
    .eq("client_id", clientId)
    .eq("group_id", groupId);
  groupsCache = null;
}

/** Move a client from one group to another */
export async function moveClientToGroup(clientId: string, fromGroupId: string, toGroupId: string): Promise<void> {
  await removeClientFromGroup(clientId, fromGroupId);
  await addClientToGroup(clientId, toGroupId);
}
