
create or replace function carl_auct.getAuctLabels(p_id_auction int)
	returns setof json security definer as $$
declare
  _j_out json;
begin
	for _j_out in
		select row_to_json(r) from (
            select l.id_label, l.name, l.color_code, l.description
              from auction_label al, label l
              where l.id_label = al.id_label
              and al.id_auction = p_id_auction
            order by l.id_label
        ) r
	loop
		return next json_strip_nulls(_j_out);
	end loop;
end $$
language plpgsql;
