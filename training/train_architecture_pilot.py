"""Architectural research pilot. Partial agent masks are NOT a BIM benchmark.

The frozen, checksum-pinned encoder runs once per crop. The final convolution or
decoder learns; BN stays fixed. --preserve-rooms exports a separate untouched room
decoder sharing the encoder, so opening training cannot rewrite floor semantics.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import sys
import types
from pathlib import Path

CHECKPOINT = 'dd20b4e1bf1d670f2125107b079df06958b1ccd36e49a464ab739aeb00b8e7a2'
SOURCE = '05a07265d9ec8cade5228b834645af00c655e1413b21d02b0b3183d041f7752a'
CLASSES = ['background','wall','door','window','cabinet','equipment','toilet','sink','bench','fireplace','bathtub','chimney','railing']

def validate_package(file, pilot):
    file = Path(file).resolve()
    m = json.loads(file.read_text(encoding='utf-8'))
    if not pilot or m.get('schemaVersion') != 'ark-architecture-pilot-1' or m.get('independentValidation') is not False or m.get('annotationQuality') != 'agent-provisional' or m.get('ignoreIndex') != 255:
        raise ValueError('Explicit --pilot required; provisional masks cannot claim independence')
    groups = {}
    for r in m.get('records', []):
        if r.get('split') not in ['train','diagnostic']:
            raise ValueError('Invalid architecture split')
        group = r.get('buildingGroup')
        if not group or group in groups and groups[group] != r['split']:
            raise ValueError('Architecture building leakage')
        groups[group] = r['split']
        for key in ['image','rooms','icons']:
            p = (file.parent / r[key]).resolve()
            if not p.is_relative_to(file.parent) or not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest() != r[key+'Sha256']:
                raise ValueError('Missing or changed architecture asset')
    if not any(r['split']=='train' for r in m.get('records', [])):
        raise ValueError('No training masks')
    if set(m.get('trainingGroups',[]))!={k for k,v in groups.items() if v=='train'} or set(m.get('diagnosticGroups',[]))!={k for k,v in groups.items() if v=='diagnostic'}:
        raise ValueError('Architecture group manifest mismatch')
    return m

def load_source(directory, torch):
    for name, expected in [('weights.pkl',CHECKPOINT),('hg_furukawa_original.py',SOURCE)]:
        if hashlib.sha256((directory/name).read_bytes()).hexdigest() != expected:
            raise ValueError('Pinned architecture source changed')
    sys.modules['floortrans'] = types.ModuleType('floortrans')
    sys.modules['floortrans.models'] = types.ModuleType('floortrans.models')
    sys.modules['floortrans.models'].model_1427 = None
    spec = importlib.util.spec_from_file_location('ark_architecture_pinned', directory/'hg_furukawa_original.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    model = module.hg_furukawa_original(44)
    model.load_state_dict(torch.load(directory/'weights.pkl', map_location='cpu', weights_only=True)['model_state'], strict=True)
    return model.eval()

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--manifest', required=True);p.add_argument('--output', required=True)
    p.add_argument('--pilot', action='store_true');p.add_argument('--validate-only',action='store_true')
    p.add_argument('--epochs',type=int,default=24);p.add_argument('--threads',type=int,default=4)
    p.add_argument('--lr',type=float,default=.001)
    p.add_argument('--size',type=int,default=512)
    p.add_argument('--decoder',action='store_true')
    p.add_argument('--preserve-rooms',action='store_true',help='Train openings only; export the original room decoder unchanged')
    p.add_argument('--opening-run',help='Train rooms only while retaining a checksum-verified opening pilot decoder')
    args=p.parse_args();file=Path(args.manifest).resolve();m=validate_package(file,args.pilot)
    train=[r for r in m['records'] if r['split']=='train']
    if args.validate_only:
        print(json.dumps({'samples':len(train),'independentValidation':False}));return
    output=Path(args.output).resolve()
    if not output.is_relative_to(Path('.data/training').resolve()) or output.exists() or not 1<=args.epochs<=100 or not 1<=args.threads<=8 or not 0<args.lr<=.01 or args.size not in [256,320,384,512] or args.preserve_rooms and not args.decoder or args.opening_run and (args.preserve_rooms or not args.decoder):
        raise ValueError('Invalid private training output/options')
    import numpy as np
    import torch
    import torch.nn.functional as F
    from PIL import Image
    torch.set_num_threads(args.threads);torch.manual_seed(42);np.random.seed(42)
    net=load_source(Path('.data/models/cubicasa-multitask-v1'),torch)
    original_rooms = copy.deepcopy(torch.nn.Sequential(net.conv2_,net.bn2,net.relu2,net.conv3_,net.bn3,net.relu3,net.conv4_,net.upsample)).eval() if args.preserve_rooms else None
    opening_decoder=None;opening_manifest=None
    if args.opening_run:
        folder=Path(args.opening_run).resolve();opening_manifest=json.loads((folder/'manifest.json').read_text())
        if not folder.is_relative_to(Path('.data/training').resolve()) or opening_manifest.get('id')!='ark-architecture-pilot-v1' or opening_manifest.get('training',{}).get('preserveRooms') is not True or hashlib.sha256((folder/'weights-state.pt').read_bytes()).hexdigest()!=opening_manifest.get('checkpointSha256'):
            raise ValueError('Unverified opening decoder')
        opening_net=load_source(Path('.data/models/cubicasa-multitask-v1'),torch)
        opening_net.load_state_dict(torch.load(folder/'weights-state.pt',map_location='cpu',weights_only=True),strict=True)
        opening_decoder=copy.deepcopy(torch.nn.Sequential(opening_net.conv2_,opening_net.bn2,opening_net.relu2,opening_net.conv3_,opening_net.bn3,opening_net.relu3,opening_net.conv4_,opening_net.upsample)).eval()
        del opening_net
        for param in opening_decoder.parameters():param.requires_grad_(False)
    if original_rooms:
        for param in original_rooms.parameters():param.requires_grad_(False)
    for param in net.parameters():param.requires_grad_(False)
    for param in net.conv4_.parameters():param.requires_grad_(True)
    modules=[net.conv4_]
    if args.decoder:
        modules=[net.conv2_,net.conv3_,net.conv4_,net.upsample]
        for module in modules:
            for param in module.parameters():param.requires_grad_(True)
    original={k:v.detach().clone() for k,v in net.conv4_.state_dict().items()}
    upsample_original={k:v.detach().clone() for k,v in net.upsample.state_dict().items()}
    # Frozen encoder; batch norm never updates on this tiny pilot.
    features=[];hook=(net.conv2_ if args.decoder else net.conv4_).register_forward_pre_hook(lambda _module,inputs:features.append(inputs[0].detach().clone()))
    cached=[];S=args.size
    for r in train:
        image=Image.open(file.parent/r['image']).convert('RGB');w,h=image.size;k=min(S/w,S/h);rw,rh=round(w*k),round(h*k);left,top=(S-rw)//2,(S-rh)//2
        canvas=Image.new('RGB',(S,S),'white');canvas.paste(image.resize((rw,rh),Image.Resampling.BILINEAR),(left,top))
        x=torch.from_numpy(np.array(canvas).copy()).permute(2,0,1).float().unsqueeze(0)/127.5-1
        targets=[]
        for head,max_label in [('rooms',11),('icons',10)]:
            mask=Image.open(file.parent/r[head]).convert('L')
            if mask.size!=(w,h):raise ValueError('Mask/image dimensions differ')
            mask_canvas=Image.new('L',(S,S),255);mask_canvas.paste(mask.resize((rw,rh),Image.Resampling.NEAREST),(left,top));a=np.array(mask_canvas).copy()
            if not set(np.unique(a)).issubset(set(range(max_label+1))|{255}):raise ValueError('Invalid partial mask category')
            targets.append(torch.from_numpy(a).long().unsqueeze(0))
        if all((t==255).all() for t in targets):raise ValueError('No supervised architecture pixels in crop')
        with torch.no_grad():teacher=net(x)[:,21:44].detach().clone()
        cached.append((features.pop(),targets,teacher))
        print(json.dumps({'stage':'cached','sample':r['id'],'total':len(cached)}),flush=True)
    hook.remove();output.mkdir();parameters=[p for module in modules for p in module.parameters()];optimizer=torch.optim.AdamW(parameters,lr=args.lr,weight_decay=.0001)
    room_weights=torch.tensor([1.,.8,1.5,.8,.8,.8,.8,.8,.8,.8,1.,.8]);icon_weights=torch.tensor([1.,3.,2.,1.,1.,1.,1.,1.,1.,1.,1.])
    history=[]
    for epoch in range(args.epochs):
        losses=[]
        for index in np.random.permutation(len(cached)):
            feature,(rooms,icons),teacher=cached[index];optimizer.zero_grad(set_to_none=True)
            if args.decoder:feature=net.relu3(net.bn3(net.conv3_(net.relu2(net.bn2(net.conv2_(feature))))))
            prediction=net.upsample(net.conv4_(feature))[:,21:44]
            loss=torch.tensor(0.)
            for truth,logits,weights,old in [(rooms,prediction[:,:12],room_weights,teacher[:,:12]),(icons,prediction[:,12:],icon_weights,teacher[:,12:])]:
                if args.preserve_rooms and truth is rooms:continue
                if args.opening_run and truth is icons:continue
                if (truth!=255).any():loss=loss+F.cross_entropy(logits,truth,weight=weights,ignore_index=255)
                unknown=truth==255
                if unknown.any():
                    kl=F.kl_div(F.log_softmax(logits,dim=1),F.softmax(old,dim=1),reduction='none').sum(dim=1)
                    loss=loss+.02*kl[unknown].mean()
            loss=loss+.001*sum((value-original[name]).square().mean() for name,value in net.conv4_.named_parameters())
            if not torch.isfinite(loss):raise ValueError('Non-finite architecture loss')
            loss.backward()
            for param in net.conv4_.parameters():
                param.grad[:(33 if args.preserve_rooms else 21)]=0;param.grad[36:]=0
                if args.opening_run:param.grad[33:]=0
            if args.decoder:
                net.upsample.weight.grad[:,:21]=0;net.upsample.bias.grad[:21]=0
            torch.nn.utils.clip_grad_norm_(parameters,2.);optimizer.step()
            # AdamW decay would otherwise move supposedly frozen output rows.
            with torch.no_grad():
                for name,param in net.conv4_.named_parameters():param[:(33 if args.preserve_rooms else 21)].copy_(original[name][:(33 if args.preserve_rooms else 21)]);param[36:].copy_(original[name][36:])
                if args.opening_run:
                    for name,param in net.conv4_.named_parameters():param[33:].copy_(original[name][33:])
                if args.decoder:
                    net.upsample.weight[:,:21].copy_(upsample_original['weight'][:,:21]);net.upsample.bias[:21].copy_(upsample_original['bias'][:21])
            losses.append(float(loss.detach()))
        row={'epoch':epoch+1,'loss':sum(losses)/len(losses),'scope':'training-fit-only','independentValidation':False};history.append(row)
        (output/'history.json').write_text(json.dumps(history,indent=2));print(json.dumps(row),flush=True)
    net.eval();checkpoint=output/'weights-state.pt';torch.save(net.state_dict(),checkpoint)
    class Heads(torch.nn.Module):
        def __init__(self,model,room_decoder,icons_decoder):
            super().__init__();self.net=model;self.room_decoder=room_decoder;self.icons_decoder=icons_decoder;self.features=None
            if room_decoder is not None or icons_decoder is not None:self.net.conv2_.register_forward_pre_hook(self.capture)
        def capture(self,_module,inputs):self.features=inputs[0]
        def forward(self,image):
            prediction=self.net(image)
            rooms=self.room_decoder(self.features)[:,21:33] if self.room_decoder is not None else prediction[:,21:33]
            icons=self.icons_decoder(self.features)[:,33:44] if self.icons_decoder is not None else prediction[:,33:44]
            return rooms,icons
    target=output/'model.onnx'
    with torch.no_grad():torch.onnx.export(Heads(net,original_rooms,opening_decoder).eval(),torch.zeros(1,3,512,512),str(target),input_names=['image'],output_names=['rooms','icons'],opset_version=18,dynamo=False,external_data=False)
    digest=hashlib.sha256(file.read_bytes()).hexdigest()
    manifest={'id':'ark-architecture-pilot-v1','revision':digest[:40],'checkpointSha256':hashlib.sha256(checkpoint.read_bytes()).hexdigest(),'artifactSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'sourceSha256':SOURCE,
        'classes':CLASSES,'size':512,'outputLayout':'cubicasa-multitask-v1','usage':'experimental-research','codeLicense':'CC-BY-NC-4.0','trainingDatasetLicense':'private-user-data-and-NC-pretraining',
        'preprocessing':{'mean':[.5]*3,'std':[.5]*3,'letterbox':True},'training':{'annotationQuality':'agent-provisional','independentValidation':False,'datasetSha256':digest,'parentCheckpointSha256':CHECKPOINT,'images':len(train),'epochs':args.epochs,'buildingGroups':m['trainingGroups'],'heldOutBuildingGroups':m['diagnosticGroups'],'preserveRooms':args.preserve_rooms,'scope':('opening-decoder-original-room-head' if args.preserve_rooms else 'frozen-encoder-trained-decoder' if args.decoder else 'head-only')+'; no independent architectural accuracy claim'}}
    if opening_manifest:
        manifest['id']='ark-architecture-pilot-v2';manifest['training']['openingCheckpointSha256']=opening_manifest['checkpointSha256'];manifest['training']['openingArtifactSha256']=opening_manifest['artifactSha256'];manifest['training']['openingEpochs']=opening_manifest['training']['epochs'];manifest['training']['scope']='room-decoder-with-preserved-opening-decoder; no independent architectural accuracy claim'
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps({'stage':'exported','images':len(train),'epochs':args.epochs,'independentValidation':False}),flush=True)
if __name__=='__main__':main()
