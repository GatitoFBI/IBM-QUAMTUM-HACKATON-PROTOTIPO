"""Compare exact compilation levels without changing the adaptive search algorithm.

Run beside qiskit_grover.py and qiskit_grover_noise.py, or pass --source-dir.
"""
import argparse,csv,hashlib,importlib.metadata,json,math,platform,sys,time
from pathlib import Path

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-dir',type=Path,default=Path(__file__).resolve().parent)
parser.add_argument('--baseline',type=Path,required=True)
parser.add_argument('--output',type=Path,default=Path('resultados_mitigacion'))
args=parser.parse_args()
sys.path.insert(0,str(args.source_dir.resolve()))

import numpy as np
from qiskit import transpile,qasm2
from qiskit.quantum_info import Statevector
import qiskit_grover as original
from qiskit_grover_noise import BASIS,PROFILES,THERMAL,DistributionCache,adaptive_run,summarize,write_csv

class OptimizedCache(DistributionCache):
    def __init__(self,level):
        super().__init__(PROFILES+(THERMAL,),42)
        self.level=level
        self.max_ideal_error=0.0
    def circuit(self,qubits,marked,iterations):
        key=(qubits,tuple(sorted(set(marked))),iterations)
        if key not in self.compiled:
            start=time.perf_counter()
            logical=original.circuito_grover(*key)
            qc=transpile(logical,basis_gates=list(BASIS),optimization_level=self.level,
                         approximation_degree=1.0,seed_transpiler=42)
            expected=Statevector(logical).probabilities()
            observed=Statevector(qc).probabilities()
            error=float(np.max(np.abs(expected-observed)))
            assert error<1e-10,(key,error)
            self.max_ideal_error=max(self.max_ideal_error,error)
            ops=dict(qc.count_ops())
            assert set(ops)<=set(BASIS)
            metrics={'circuit_sha256':hashlib.sha256(qasm2.dumps(qc).encode()).hexdigest(),
                     'qubits':qubits,'marked':list(key[1]),'j':iterations,'depth':qc.depth(),
                     'cx':ops.get('cx',0),'physical_1q':ops.get('sx',0)+ops.get('x',0),
                     'virtual_rz':ops.get('rz',0),'operations':ops}
            self.compiled[key]=(qc,metrics)
            self.compile_seconds+=time.perf_counter()-start
        return self.compiled[key]

def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()

start=time.perf_counter()
baseline=json.loads(args.baseline.read_text())
instance=next(i for i in baseline['instances'] if i['n']==4)
costs=instance['costs'];assert instance['optimal_indices']==[23]
profiles=PROFILES+(THERMAL,)
runs=[];steps=[];circuits=[];summaries=[];caches=[]
out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
for level in (0,3):
    cache=OptimizedCache(level)
    for profile in profiles:
        for j in range(5):
            probabilities,metrics=cache.get(5,[23],j,profile)
            raw=cache.distributions[(5,(23,),j,profile)][1]
            if level==0:
                b=next(x for x in baseline['sweep'] if (x['n'],x['profile'],x['j'])==(4,profile.name,j))
                assert abs(probabilities[23]-b['p_marked'])<1e-10
                assert (metrics['cx'],metrics['depth'])==(b['cx'],b['depth'])
            circuits.append({'n':4,'optimization_level':level,'profile':profile.name,'j':j,
                             'p_marked':float(probabilities[23]),'p_invalid':float(sum(probabilities[24:])),
                             'p_before_readout':float(raw[23]),
                             **{k:metrics[k] for k in ['cx','physical_1q','virtual_rz','depth','circuit_sha256']}})
        for seed in range(42,142):
            result=adaptive_run(costs,np.random.default_rng(seed),cache,profile)
            labels={'n':4,'optimization_level':level,'profile':profile.name,'seed':seed,'algorithm':'grover'}
            steps.extend({**labels,**s} for s in result.pop('steps'))
            if level==0:
                prior=next(x for x in baseline['runs'] if (x['n'],x['profile'],x['seed'],x['algorithm'])==(4,profile.name,seed,'grover'))
                assert all(result[k]==prior[k] for k in result),('baseline mismatch',profile.name,seed)
            runs.append({**labels,**result})
        print('level',level,profile.name,'successes',sum(r['optimal'] for r in runs if r['optimization_level']==level and r['profile']==profile.name),flush=True)
    rows=[r for r in runs if r['optimization_level']==level]
    summaries.extend({'optimization_level':level,**s} for s in summarize(rows))
    caches.append({'optimization_level':level,'unique_compiled':len(cache.compiled),
                   'unique_distributions':len(cache.distributions),'max_ideal_probability_error':cache.max_ideal_error})
    # Same random decisions in the ideal simulation must preserve the entire trace.
    if level==3:
        a=[s for s in steps if s['optimization_level']==0 and s['profile']=='ideal']
        b=[s for s in steps if s['optimization_level']==3 and s['profile']=='ideal']
        assert [[s[k] for k in ['seed','step','y','j','outcome','budget_used']] for s in a]==[[s[k] for k in ['seed','step','y','j','outcome','budget_used']] for s in b]
paired=[]
for profile in profiles:
    a=sorted([r for r in runs if r['optimization_level']==0 and r['profile']==profile.name],key=lambda r:r['seed'])
    b=sorted([r for r in runs if r['optimization_level']==3 and r['profile']==profile.name],key=lambda r:r['seed'])
    wins=sum(not x['optimal'] and y['optimal'] for x,y in zip(a,b))
    losses=sum(x['optimal'] and not y['optimal'] for x,y in zip(a,b))
    discord=wins+losses
    pvalue=min(1.0,2*sum(math.comb(discord,k) for k in range(min(wins,losses)+1))/(2**discord)) if discord else 1.0
    paired.append({'profile':profile.name,'runs':100,'both_success':sum(x['optimal'] and y['optimal'] for x,y in zip(a,b)),
                   'both_failure':sum(not x['optimal'] and not y['optimal'] for x,y in zip(a,b)),
                   'level3_only_success':wins,'level0_only_success':losses,
                   'success_difference_pp':wins-losses,'mcnemar_exact_two_sided_p':pvalue})
meta={'generated_utc':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
      'command':[sys.executable,*sys.argv],'python':sys.version,'platform':platform.platform(),
      'versions':{p:importlib.metadata.version(p) for p in ('qiskit','qiskit-aer','numpy')},
      'source_sha256':digest(original.__file__),'noise_benchmark_sha256':digest(args.source_dir/'qiskit_grover_noise.py'),
      'experiment_sha256':digest(__file__),'baseline_results_sha256':digest(args.baseline),
      'basis_gates':list(BASIS),'transpiler_seed':42,'approximation_degree':1.0,
      'levels':[0,3],'profiles':[p.name for p in profiles],'repetitions':100,'seed_start':42,
      'diagnostic_marked':[23],'diagnostic_j':[0,1,2,3,4],
      'elapsed_seconds':time.perf_counter()-start,'cache_metrics':caches,
      'validation':{'baseline_500_runs_match':True,'ideal_100_traces_match_between_levels':True,
                    'all_compiled_ideal_probabilities_error_lt_1e_10':True,'baseline_diagnostic_match':True},
      'scope':'One fixed N4 instance; synthetic noise, no backend or routing; BBHT and budgets unchanged.'}
result={'metadata':meta,'circuits':circuits,'summary':summaries,'runs':runs,'paired':paired}
(out/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
for name,rows in [('circuits',circuits),('summary',summaries),('runs',runs),('steps',steps),('paired',paired)]:write_csv(out/(name+'.csv'),rows)
readme='''# Compilación optimizada como medida frente al ruido

Segunda campaña independiente: N4, niveles0 y3, 100 semillas42..141 por5perfiles, mismo BBHT y presupuesto, base rz/sx/x/cx, seed_transpiler42, approximation_degree1.0, sin routing.

Se conservan los modelos exactos de qiskit_grover_noise.py. Cada circuito compilado se contrasta con Statevector del original. El nivel0 reproduce los500 registros completos de N4 de la campaña principal y el diagnóstico original; las100 trazas ideales de ambos niveles tienen las mismas muestras, j, umbral y presupuesto.

circuits.csv:50filas, dos niveles×cinco j×cinco perfiles; p_marked,p_invalid,p_before_readout son fracciones0..1. summary.csv:10grupos; runs.csv:1000ejecuciones; steps.csv:todos sus pasos. paired.csv:pares porsemilla; level3_only_success y level0_only_success son discordancias, success_difference_pp es diferencia de puntos porcentuales sobre100, y mcnemar_exact_two_sided_p usa la binomial exacta con p0=1/2 sobre los discordantes. Sus pvalores son exploratorios, sin ajuste por comparar perfiles; no prueban generalización a otras matrices. Los IC de summary son marginales Wilson95%, no de las diferencias.

El diagnóstico marca el óptimo conocido23; su j óptimo no es una política validada de BBHT. El ruido se aplica al circuito compilado común a todos los perfiles de cada nivel. La mejora de compilación preserva el ideal, pero el ruido puede responder de forma distinta porque cambian las puertas y su secuencia.

Reproducir desde la carpeta codigo del paquete:

```sh
.venv-noise/bin/python qiskit_grover_mitigation.py --source-dir . --baseline ../evidencia/original/results.json --output resultados_mitigacion
```

Se necesitan las dependencias de requirements-noise.txt. El JSON registra versiones, hashes, comando original y tiempo; todos los registros se producen con el mismo generador sin modificar la campaña principal.
'''
(out/'README.md').write_text(readme,encoding='utf-8')
print(json.dumps({'seconds':meta['elapsed_seconds'],'summary':summaries,'paired':paired},ensure_ascii=False))
