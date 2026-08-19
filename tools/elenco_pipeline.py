import bpy, sys, math, os
from mathutils import Vector
a=sys.argv[sys.argv.index('--')+1:]
glb, nome, saida = a[0], a[1], a[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
ob=[o for o in bpy.data.objects if o.type=='MESH'][0]
bpy.context.view_layer.objects.active=ob; ob.select_set(True)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.separate(type='LOOSE'); bpy.ops.object.mode_set(mode='OBJECT')
partes=[o for o in bpy.data.objects if o.type=='MESH']

# agrupamento por VERTICE (caixa alinhada aos eixos cola coisas que nao se tocam)
CEL=0.004; balde={}
for idx,o in enumerate(partes):
    M=o.matrix_world; vs=o.data.vertices; passo=max(1,len(vs)//4000)
    for i in range(0,len(vs),passo):
        w=M @ vs[i].co
        balde.setdefault((int(w.x//CEL),int(w.y//CEL),int(w.z//CEL)),set()).add(idx)
pai=list(range(len(partes)))
def acha(x):
    while pai[x]!=x: pai[x]=pai[pai[x]]; x=pai[x]
    return x
def une(x,y):
    rx,ry=acha(x),acha(y)
    if rx!=ry: pai[rx]=ry
for k,ids in balde.items():
    ids=list(ids)
    for i in range(1,len(ids)): une(ids[0],ids[i])
    for d in ((1,0,0),(0,1,0),(0,0,1),(1,1,0),(1,0,1),(0,1,1),(1,1,1)):
        viz=balde.get((k[0]+d[0],k[1]+d[1],k[2]+d[2]))
        if viz: une(ids[0], next(iter(viz)))
grupos={}
for i,o in enumerate(partes): grupos.setdefault(acha(i),[]).append(o)
for g in grupos.values():
    for o in g: o.data.calc_loop_triangles()
lista=sorted(grupos.values(), key=lambda g:-sum(len(o.data.loop_triangles) for o in g))
print("### %s: %d peca(s) soltas em %d grupo(s); personagem tem %d peca(s)" %
      (nome, len(partes), len(lista), len(lista[0])))
for o in [x for x in partes if x not in lista[0]]: bpy.data.objects.remove(o, do_unlink=True)

pers=[o for o in bpy.data.objects if o.type=='MESH']
for o in pers: o.select_set(True)
bpy.context.view_layer.objects.active=pers[0]; bpy.ops.object.join()
her=bpy.context.active_object; her.name=nome
her.data.calc_loop_triangles(); n=len(her.data.loop_triangles)
m=her.modifiers.new('d','DECIMATE'); m.ratio=min(1.0,12000.0/n); bpy.ops.object.modifier_apply(modifier='d')
def caixa():
    mn=Vector((1e9,)*3); mx=Vector((-1e9,)*3)
    for v in her.data.vertices:
        w=her.matrix_world @ v.co
        for i in range(3): mn[i]=min(mn[i],w[i]); mx[i]=max(mx[i],w[i])
    return mn,mx
mn,mx=caixa(); esc=1.80/(mx.z-mn.z); her.scale=(esc,)*3
bpy.context.view_layer.update(); mn,mx=caixa()
ombro=mn.z+(mx.z-mn.z)*0.62
xs=sorted((her.matrix_world@v.co).x for v in her.data.vertices if (her.matrix_world@v.co).z<ombro)
ys=sorted((her.matrix_world@v.co).y for v in her.data.vertices if (her.matrix_world@v.co).z<ombro)
her.location=(-xs[len(xs)//2], -ys[len(ys)//2], -mn.z)
bpy.context.view_layer.update(); mn,mx=caixa()
print("### %s: %d tri  altura 1,80 m  largura %.2f celulas (de %+.2f a %+.2f)" %
      (nome, len(her.data.loop_triangles), mx.x-mn.x, mn.x, mx.x))

def mat(nm,cor):
    mt=bpy.data.materials.new(nm); mt.use_nodes=True
    b=mt.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value=cor; b.inputs['Roughness'].default_value=1.0
    if 'Specular IOR Level' in b.inputs: b.inputs['Specular IOR Level'].default_value=0.02
    return mt
c1=mat('c1',(0.055,0.075,0.100,1)); c2=mat('c2',(0.038,0.055,0.075,1)); cA=mat('cA',(0.030,0.150,0.080,1))
for gx in range(-3,4):
    for gy in range(-3,4):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(gx,gy,-0.05))
        c=bpy.context.active_object; c.scale=(0.485,0.485,0.05)
        c.data.materials.append(cA if (gx==0 and gy==0) else (c1 if (gx+gy)%2==0 else c2))
cena=bpy.context.scene
ids=[i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
cena.render.engine='BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in ids else 'BLENDER_EEVEE'
cena.render.resolution_x=760; cena.render.resolution_y=680
cena.world=bpy.data.worlds.new('w'); cena.world.use_nodes=True
cena.world.node_tree.nodes['Background'].inputs[0].default_value=(0.04,0.05,0.065,1)
sol=bpy.data.objects.new('sol', bpy.data.lights.new('sol','SUN')); cena.collection.objects.link(sol)
sol.data.energy=3.4; sol.data.angle=math.radians(9); sol.rotation_euler=(math.radians(52),0,math.radians(-38))
cd=bpy.data.cameras.new('c'); cd.type='ORTHO'; cd.ortho_scale=4.6
co=bpy.data.objects.new('c',cd); cena.collection.objects.link(co); cena.camera=co
alvo=Vector((0,0,0.9)); d=14; tilt=math.radians(38); az=math.radians(45)
co.location=alvo+Vector((math.sin(az)*d*math.cos(tilt), -math.cos(az)*d*math.cos(tilt), math.sin(tilt)*d))
co.rotation_euler=(alvo-co.location).normalized().to_track_quat('-Z','Y').to_euler()
cena.render.filepath=os.path.join(saida,'e_%s.png'%nome)
bpy.ops.render.render(write_still=True)
