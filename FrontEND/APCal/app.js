(() => {
  const $ = id => document.getElementById(id);
  const fields = ['product','valuation','exposure','facility','bicRate','insurance','stampMode','stampRate','period','irr','scheduleType','bulkPercent','bulkAmount','cribCharges','cribScore','valuationCharges','serviceCharges','vatRate','otherRmv','rmvType'];
  const n = id => Math.max(0, Number($(id).value) || 0);
  const money = value => (Number.isFinite(value) ? value : 0).toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2});
  const pmt = (rate, periods, principal, future = 0) => {
    if (periods <= 0) return 0;
    if (rate === 0) return Math.max(0,(principal-future)/periods);
    const factor = Math.pow(1+rate,periods);
    return (principal*factor-future)*rate/(factor-1);
  };
  function readBulletRows(period) {
    return [...$('bulletRows').querySelectorAll('.bullet-row')].map(row => {
      const monthInput=row.querySelector('.bullet-month');
      monthInput.max=String(period);
      const month=Math.max(1,Math.min(period,Math.floor(Number(monthInput.value)||1)));
      monthInput.value=String(month);
      return {month,amount:Math.max(0,Number(row.querySelector('.bullet-amount').value)||0)};
    }).filter(row=>row.amount>0);
  }
  function calculate() {
    const valuation=n('valuation'), exposure=n('exposure'), facility=n('facility'), bicRate=n('bicRate')/100, insurance=n('insurance'), rate=n('irr')/1200;
    const period=Math.max(1,Math.min(72,Math.floor(n('period')))), stampRate=n('stampRate')/100;
    const bic = $('product').value==='AUTO LOANS' && bicRate===.02 ? facility*.01 : facility*bicRate;
    const stamp = facility*stampRate;
    const capitalStamp=$('stampMode').value==='capitalized' ? stamp : 0;
    const principal=facility+bic+insurance+capitalStamp;
    const type=$('scheduleType').value, bulkAmount=Math.min(n('bulkAmount'),principal), bulkPct=n('bulkPercent')/100;
    const lastBulk=type==='bulk' ? (bulkAmount>0 ? bulkAmount : facility*bulkPct) : 0;
    const customBullets=readBulletRows(period), bulletByMonth=Array(period+1).fill(0);
    customBullets.forEach(item=>{bulletByMonth[item.month]+=item.amount;});
    if(type==='bulk') bulletByMonth[period]+=lastBulk;
    const paymentMonths=type==='bulk' ? Math.max(0,period-1) : period;
    let regular;
    if(type==='bulk' && period>1 && customBullets.length===0){
      regular=Math.ceil(pmt(rate,period-1,principal,lastBulk*(1-rate+rate*rate)));
    }else if(customBullets.length===0){
      regular=Math.ceil(pmt(rate,period,principal)+150);
    }else{
      const bulletFuture=bulletByMonth.reduce((sum,amount,month)=>sum+(month?amount*Math.pow(1+rate,period-month):0),0);
      let paymentFactor=0;
      for(let month=1;month<=paymentMonths;month++) paymentFactor+=Math.pow(1+rate,period-month);
      const netPayment=paymentFactor>0?Math.max(0,(principal*Math.pow(1+rate,period)-bulletFuture)/paymentFactor):0;
      regular=Math.ceil(netPayment+(type==='normal'?150:0));
    }
    const bulletTotal=bulletByMonth.reduce((sum,amount)=>sum+amount,0);
    const scheduled=regular*paymentMonths+bulletTotal;
    let bal=principal,totalInterest=0,rows=[];
    for(let month=1;month<=period;month++){
      const opening=bal, interest=opening*rate, rental=month<=paymentMonths?regular:0, bullet=bulletByMonth[month];
      const capital=Math.max(0,rental-interest), close=Math.max(0,opening-capital-bullet);
      totalInterest+=interest; rows.push({month,opening,rental,interest,capital,bulk:bullet,close,due:rental+bullet}); bal=close;
    }
    const charges={crib:n('cribCharges'),score:n('cribScore'),valuation:n('valuationCharges'),service:n('serviceCharges'),bicCollected:$('product').value==='AUTO LOANS'?bic:0,vat:0,other:n('otherRmv'),rmv:n('rmvType'),stamp:$('stampMode').value==='paid'?stamp:0};
    charges.vat=(charges.service+charges.bicCollected)*(n('vatRate')/100);
    const totalCharges=Object.values(charges).reduce((a,b)=>a+b,0);
    const residualValue=facility*bulkPct, residualRental=Math.ceil(pmt(rate,period,principal,residualValue)+150);
    const residualPaid=residualRental*period+residualValue, residualInterest=Math.max(0,residualPaid-principal);
    $('monthlyRental').textContent=money(regular); $('ratePer100k').textContent=money(regular/(facility/100000||1)); $('totalInterest').textContent=money(Math.max(0,scheduled-principal)); $('totalPaid').textContent=money(scheduled); $('amountFinanced').textContent=money(principal);
    $('residualRental').textContent=money(residualRental); $('residualValue').textContent=money(residualValue); $('residualInterest').textContent=money(residualInterest); $('residualPaid').textContent=money(residualPaid);
    $('chargeTotal').textContent=money(totalCharges); $('bicCollected').textContent=money(charges.bicCollected); $('vatAmount').textContent=money(charges.vat); $('rmvAmount').textContent=money(charges.rmv); $('stampCharge').textContent=money(charges.stamp);
    const note=$('exposureNote'), actual=valuation ? facility/valuation*100 : 0, allowed=valuation*exposure/100;
    note.textContent=valuation ? `Exposure: ${actual.toFixed(2)}% · maximum facility at ${exposure}%: LKR ${money(allowed)}` : '';
    note.classList.toggle('over',valuation>0 && facility>allowed);
    $('scheduleRows').innerHTML=rows.map(r=>`<tr><td>${r.month}</td><td>${money(r.opening)}</td><td>${money(r.rental)}</td><td>${money(r.interest)}</td><td>${money(r.capital)}</td><td>${money(r.bulk)}</td><td>${money(r.close)}</td><td>${money(r.due)}</td></tr>`).join('');
  }
  function addBulletRow(month=Math.ceil(n('period')/2), amount=''){
    const row=document.createElement('div'); row.className='bullet-row';
    row.innerHTML=`<label><span>Month</span><input class="bullet-month" type="number" min="1" max="72" step="1" value="${month}"></label><label><span>Amount (LKR)</span><input class="bullet-amount" type="number" min="0" step="1000" value="${amount}" placeholder="Amount"></label><button class="bullet-remove" type="button" aria-label="Remove bullet payment">×</button>`;
    $('bulletRows').appendChild(row);
    row.querySelectorAll('input').forEach(input=>{input.addEventListener('input',calculate);input.addEventListener('change',calculate);});
    row.querySelector('.bullet-remove').addEventListener('click',()=>{row.remove();calculate();});
    calculate();
  }
  fields.forEach(id=>$(id).addEventListener('input',calculate)); fields.forEach(id=>$(id).addEventListener('change',calculate));
  $('addBullet').addEventListener('click',()=>addBulletRow());
  $('scheduleButton').addEventListener('click',()=>{const open=$('scheduleSection').hidden;$('scheduleSection').hidden=!open;$('scheduleButton').setAttribute('aria-expanded',String(open));$('scheduleButton').textContent=open?'HIDE RENTAL SCHEDULE':'SHOW RENTAL SCHEDULE';if(open)$('scheduleSection').scrollIntoView({behavior:'smooth',block:'start'});});
  $('printButton').addEventListener('click',()=>window.print());
  calculate();
})();
