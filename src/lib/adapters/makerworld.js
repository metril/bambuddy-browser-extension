// Pure MakerWorld helpers: resolve response -> picker model, import body.

const isObj = (v) => v && typeof v === 'object';
const has = (v) => v !== undefined && v !== null && v !== '';

export function toPickerModel(resolved) {
  const r = isObj(resolved) ? resolved : {};
  const design = isObj(r.design) ? r.design : {};
  const instances = Array.isArray(r.instances) ? r.instances.filter(isObj) : [];
  const profiles = instances.map((inst) => {
    const id = has(inst.profileId) ? inst.profileId : has(inst.id) ? inst.id : null;
    let title = inst.title ?? inst.profileTitle ?? `Profile ${id}`;
    const printer = isObj(inst.compatibility) ? inst.compatibility.devProductName : null;
    if (printer) title = `${title} (${printer})`;
    return {
      id,
      instanceId: has(inst.id) ? inst.id : null,
      title,
      thumbnail: inst.cover ?? inst.pictures?.[0]?.url ?? null,
    };
  });
  let defaultProfileId = has(r.profile_id) ? r.profile_id : null;
  if (defaultProfileId === null && has(design.defaultInstanceId)) {
    const m = instances.find((i) => i.id === design.defaultInstanceId);
    if (m && has(m.profileId)) defaultProfileId = m.profileId;
  }
  if (defaultProfileId === null) defaultProfileId = profiles[0]?.id ?? null;
  return {
    modelId: r.model_id ?? design.id ?? null,
    title: design.title ?? null,
    designer: design.designCreator?.name ?? null,
    thumbnail: design.coverUrl ?? null,
    paid: !!design.paidSetting?.isPaid,
    defaultProfileId,
    profiles,
    alreadyImported: Array.isArray(r.already_imported_library_ids) ? r.already_imported_library_ids : [],
  };
}

export function buildImportBody({ modelId, profileId, instanceId, folderId }) {
  const body = { source_type: 'makerworld', model_id: modelId };
  if (has(profileId)) body.profile_id = profileId;
  if (has(instanceId)) body.instance_id = instanceId;
  if (has(folderId)) body.folder_id = folderId;
  return body;
}

export function canonicalUrl(modelId) {
  return `https://makerworld.com/en/models/${modelId}`;
}
